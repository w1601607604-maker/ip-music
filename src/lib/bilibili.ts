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
 * 需要去掉画质标签、括号修饰、字幕说明等，留下歌名。
 */
export function cleanKeyword(title: string): string {
  let s = stripHtml(title)

  // 去掉开头的画质/类型标签，如 【4K】【无损】【合集】
  s = s.replace(/^\s*[【\[（(][^】\]）)]*[】\]）)]\s*/g, '')
  // 去掉所有方括号/书名号内容（通常是修饰说明）
  s = s.replace(/[【\[][^】\]]*[】\]]/g, ' ')
  // 去掉圆括号内容（如 (Live) (Official Video)）
  s = s.replace(/[（(][^）)]*[）)]/g, ' ')
  // 去掉常见后缀噪声
  s = s.replace(
    /\b(?:MV|PV|OP|ED|OST|Full|Ver\.?|Official|Video|Audio|HD|HQ|4K|1080P|中日字幕|字幕|完整版|无损|合集|音乐|主题曲)\b/gi,
    ' ',
  )
  // 去掉分隔符残留
  s = s.replace(/[\/|｜·・]+/g, ' ')
  // 压缩空白
  s = s.replace(/\s+/g, ' ').trim()

  return s || stripHtml(title).trim()
}

/** 判断是否为合集类内容（时长长，通常是 OST 合集） */
function isCollection(durationSec: number): boolean {
  return durationSec >= 10 * 60 // 10 分钟以上视为合集
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

  // 排序：合集优先，然后按播放量
  merged.sort((a, b) => {
    const ca = isCollection(a.duration) ? 1 : 0
    const cb = isCollection(b.duration) ? 1 : 0
    if (ca !== cb) return cb - ca
    return b.play - a.play
  })

  return merged
}
