/**
 * B站音乐搜索封装
 *
 * 使用 B站官方 web 接口搜索视频，用于找到作品相关的音乐视频。
 * 播放通过 B站官方 iframe 播放器（player.bilibili.com），合规且稳定。
 *
 * ⚠️ 实测注意：该接口有风控，连续快速请求会返回 HTTP 412。
 *    应对：带完整浏览器请求头 + 请求间隔 + 失败重试。
 */

import type { MusicItem } from './types'

const BILI_SEARCH = 'https://api.bilibili.com/x/web-interface/search/type'

/** 完整浏览器请求头，降低风控概率 */
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
}

export class BilibiliError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'BilibiliError'
  }
}

/** 去掉 B站标题里的 HTML 高亮标签 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

/** 时长字符串 "12:34" / "1:02:03" → 秒 */
function parseDuration(d: string | number): number {
  if (typeof d === 'number') return d
  if (!d) return 0
  const parts = String(d).split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/**
 * 清洗视频标题，提取适合去网易云搜歌的关键词。
 *
 * B站音乐视频标题通常很杂乱，例如：
 *   "【4K】「进击的巨人」OP1 紅蓮の弓矢 / Linked Horizon【中日字幕】"
 *   "♫ Red Swan - YOSHIKI & HYDE S3-P1-OP ♪ 中日字幕×Hi-Res"
 * 需要去掉画质标签、括号修饰、字幕说明、装饰符号等，留下歌名。
 */
export function cleanKeyword(title: string): string {
  let s = stripHtml(title)

  // 1. 去掉装饰性符号（♫ ♪ ★ ☆ × ✕ 等），它们会干扰搜索
  s = s.replace(/[♫♪♬♩★☆✦✧×✕✖※→←↑↓▲▼◆◇●○◎§¶]+/g, ' ')

  // 2. 去掉开头的画质/类型标签，如 【4K】【无损】【合集】
  s = s.replace(/^\s*[【\[（(][^】\]）)]*[】\]）)]\s*/g, '')
  // 3. 去掉所有方括号/书名号内容（通常是修饰说明）
  s = s.replace(/[【\[][^】\]]*[】\]]/g, ' ')
  // 4. 去掉圆括号内容（如 (Live) (Official Video)）
  s = s.replace(/[（(][^）)]*[）)]/g, ' ')

  // 5. 去掉噪声词。
  //    注意：中文不能用 \b 词边界（CJK 字符不被视为 word char），
  //    所以中英文分开处理。
  const noiseWords = [
    // 英文/数字类（用词边界）
    'MV', 'PV', 'OP', 'ED', 'OST', 'BGM', 'Full', 'Ver', 'Official',
    'Video', 'Audio', 'HD', 'HQ', 'Hi-Res', 'HiRes', 'Live', 'TV',
    'Size', 'Size', 'Remix', 'Cover', 'Short', 'Version',
    // 中文类（不用词边界）
    '中日字幕', '中日双语', '中文字幕', '日文字幕', '字幕', '双语',
    '完整版', '无损', '合集', '合辑', '音乐', '音楽', '主题曲',
    '片头曲', '片尾曲', '原声', '原声带', '高音质', '超高音质',
    '清晰版', '内嵌', '收藏向', '纯音乐', '单曲', '循环',
  ]

  for (const w of noiseWords) {
    if (/^[A-Za-z0-9-]+$/.test(w)) {
      // 英文词：用词边界，避免误伤（如 "OP" 不应匹配 "OPEN"）
      s = s.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ')
    } else {
      // 中文词：直接替换
      s = s.replace(new RegExp(w, 'g'), ' ')
    }
  }

  // 6. 去掉画质数字标签（4K / 1080P / 720P）
  s = s.replace(/\b\d{3,4}[PpKk]\b/g, ' ')

  // 7. 去掉分隔符残留
  s = s.replace(/[\/|｜·・~～\-—–_]+/g, ' ')

  // 8. 去掉孤立的标点和多余空白
  s = s.replace(/[「」『』【】\[\]（）()《》〈〉]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()

  // 9. 如果清洗后太短（说明噪声词占了大半），回退到原始标题
  const cleaned = s.replace(/[^\p{L}\p{N}]/gu, '')
  if (cleaned.length < 2) {
    return stripHtml(title).replace(/\s+/g, ' ').trim()
  }

  return s
}

/** 音乐强信号词：标题里出现这些，几乎可以确定是音乐内容 */
const MUSIC_SIGNALS = [
  'ost', 'original soundtrack', '原声', 'サウンドトラック',
  'op', 'ed', '主题曲', '片头曲', '片尾曲', '插曲', '插入曲',
  '音乐', '音楽', '歌单', '专辑', 'album', 'bgm',
  '合集', '合辑', '全曲', '无损', '歌曲',
]

/** 噪声词：出现这些说明不是音乐（实况/番剧/解说等） */
const NOISE_SIGNALS = [
  '一口气看完', '全剧情', '流程', '实况', '解说', '攻略', '通关',
  '第一集', '第1集', '生肉', '熟肉', '总集篇', '剧场版', '全集',
  '预告', 'pv', 'mad', 'amv', '剪辑', '混剪', 'reaction', '反应',
  '吐槽', '影评', '漫评', '排行', 'top', '盘点', '推荐',
  'galgame', '游戏实况', '直播', '录播',
]

/**
 * 给视频打分，用于排序。
 * 分数越高越可能是"用户想听的音乐"。
 */
function scoreMusic(item: MusicItem): number {
  const t = item.title.toLowerCase()
  let score = 0

  // 音乐信号加分
  for (const s of MUSIC_SIGNALS) {
    if (t.includes(s)) score += 12
  }

  // 噪声信号大幅减分
  for (const s of NOISE_SIGNALS) {
    if (t.includes(s)) score -= 40
  }

  // 时长：10 分钟 ~ 6 小时之间最可能是音乐合集
  const d = item.duration
  if (d >= 10 * 60 && d <= 6 * 3600) score += 25
  else if (d > 6 * 3600) score -= 50 // 超长基本是番剧/实况
  else if (d > 0 && d < 10 * 60) score += 5 // 单曲，也不错

  // 播放量：对数加权，避免爆款实况碾压
  if (item.play > 0) score += Math.log10(item.play) * 3

  return score
}

/**
 * 搜索 B站音乐视频
 *
 * @param keyword 搜索关键词
 * @param page 页码
 */
export async function searchMusic(
  keyword: string,
  page = 1,
): Promise<MusicItem[]> {
  const params = new URLSearchParams({
    search_type: 'video',
    keyword,
    page: String(page),
  })

  let res: Response | null = null
  let lastErr: unknown = null

  // 风控重试：最多 3 次，指数退避
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${BILI_SEARCH}?${params}`, {
        headers: HEADERS,
        cache: 'no-store',
      })

      // 412 = 被风控，等待后重试
      if (res.status === 412) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
        continue
      }
      break
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }

  if (!res) {
    throw new BilibiliError(
      '无法连接 B站搜索服务' + (lastErr ? `：${String(lastErr)}` : ''),
    )
  }

  if (res.status === 412) {
    throw new BilibiliError(
      'B站搜索请求过于频繁，请稍后再试',
      412,
    )
  }

  if (!res.ok) {
    throw new BilibiliError(`B站返回错误（HTTP ${res.status}）`, res.status)
  }

  const json = await res.json()

  if (json?.code !== 0) {
    throw new BilibiliError(
      `B站搜索失败：${json?.message || '未知错误'}`,
      json?.code,
    )
  }

  const results: any[] = json?.data?.result || []

  const items: MusicItem[] = results
    .filter((r) => r?.bvid)
    .map((r) => {
      const title = stripHtml(r.title || '')
      return {
        bvid: r.bvid,
        title,
        author: r.author || '',
        cover: r.pic ? (r.pic.startsWith('//') ? `https:${r.pic}` : r.pic) : undefined,
        duration: parseDuration(r.duration),
        play: typeof r.play === 'number' ? r.play : 0,
        keyword: cleanKeyword(title),
      }
    })

  return items
}

/**
 * 按作品名搜索音乐，优先返回 OST / 合集类内容。
 *
 * 策略：用多个关键词组合搜索，合并去重后排序：
 *   1. 合集类（时长 >= 10 分钟）优先 —— 用户要的是"听这张作品的音乐"
 *   2. 其次按播放量排序
 */
export async function searchMusicForWork(workName: string): Promise<MusicItem[]> {
  // 关键词组合：OST 优先，其次主题曲/音乐合集
  const queries = [
    `${workName} OST`,
    `${workName} 音乐合集`,
    `${workName} 主题曲`,
  ]

  const seen = new Set<string>()
  const merged: MusicItem[] = []

  for (const q of queries) {
    try {
      const items = await searchMusic(q)
      for (const it of items) {
        if (seen.has(it.bvid)) continue
        seen.add(it.bvid)
        merged.push(it)
      }
    } catch (e) {
      // 单个关键词失败不影响整体，但要记录
      console.warn(`[bilibili] 搜索「${q}」失败：`, e)
    }
    // 请求间隔，规避风控
    await new Promise((r) => setTimeout(r, 350))
  }

  if (merged.length === 0) {
    throw new BilibiliError('未找到相关音乐，请稍后重试')
  }

  // 排序：音乐相关性打分，高分在前
  merged.sort((a, b) => scoreMusic(b) - scoreMusic(a))

  return merged
}
