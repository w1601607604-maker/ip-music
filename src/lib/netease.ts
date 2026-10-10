/**
 * 网易云歌词封装
 *
 * 只使用歌词（文本元数据）接口，不涉及版权音频：
 *   - 搜索歌曲：/api/search/get/web
 *   - 获取歌词：/api/song/lyric（含翻译 tlyric）
 *
 * 这两个接口无需登录，合规上无问题。
 */

import type { LyricLine, LyricResult } from './types'

const NETEASE = 'https://music.163.com'

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
}

export class NeteaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NeteaseError'
  }
}

interface NeteaseSong {
  id: number
  name: string
  artists?: { name: string }[]
}

/** 搜索网易云歌曲，返回候选列表 */
export async function searchSongs(keyword: string): Promise<NeteaseSong[]> {
  const params = new URLSearchParams({
    s: keyword,
    type: '1',
    offset: '0',
    limit: '10',
  })

  const res = await fetch(`${NETEASE}/api/search/get/web?${params}`, {
    headers: HEADERS,
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new NeteaseError(`网易云搜索失败（HTTP ${res.status}）`)
  }

  const json = await res.json()
  const songs: NeteaseSong[] = json?.result?.songs || []
  return songs
}

/** 解析 LRC 文本为 [{time, text}] */
function parseLrc(lrc: string): { time: number; text: string }[] {
  if (!lrc) return []

  const out: { time: number; text: string }[] = []
  const lines = lrc.split('\n')

  for (const line of lines) {
    // 匹配 [mm:ss.xx] 或 [mm:ss.xxx]，一行可能有多个时间标签
    const timeTags = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (timeTags.length === 0) continue

    const text = line.replace(/\[[^\]]*\]/g, '').trim()

    for (const tag of timeTags) {
      const min = parseInt(tag[1], 10)
      const sec = parseInt(tag[2], 10)
      const msStr = tag[3] || '0'
      // 统一成毫秒：1 位=百分秒，2 位=百分秒，3 位=毫秒
      const ms =
        msStr.length === 3
          ? parseInt(msStr, 10)
          : parseInt(msStr.padEnd(2, '0'), 10) * 10

      out.push({ time: min * 60 * 1000 + sec * 1000 + ms, text })
    }
  }

  return out.sort((a, b) => a.time - b.time)
}

/**
 * 合并原文与翻译歌词。
 * 按时间戳对齐 —— 翻译 LRC 的时间戳通常与原文一致。
 */
function mergeTranslation(
  original: { time: number; text: string }[],
  translation: { time: number; text: string }[],
): LyricLine[] {
  const transMap = new Map<number, string>()
  for (const t of translation) {
    if (t.text) transMap.set(t.time, t.text)
  }

  return original
    .filter((l) => l.text) // 去掉纯时间戳的空行
    .map((l) => ({
      time: l.time,
      text: l.text,
      translation: transMap.get(l.time),
    }))
}

/** 获取指定歌曲的歌词（含翻译） */
export async function fetchLyricById(songId: number): Promise<{
  lrc: string
  tlyric: string
}> {
  const params = new URLSearchParams({
    id: String(songId),
    lv: '1',
    kv: '1',
    tv: '-1',
  })

  const res = await fetch(`${NETEASE}/api/song/lyric?${params}`, {
    headers: HEADERS,
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new NeteaseError(`网易云歌词请求失败（HTTP ${res.status}）`)
  }

  const json = await res.json()
  return {
    lrc: json?.lrc?.lyric || '',
    tlyric: json?.tlyric?.lyric || '',
  }
}

/**
 * 主入口：根据关键词找歌词
 *
 * 链路：关键词 → 搜索歌曲 → 取最佳匹配 → 拉歌词 → 合并翻译
 *
 * 匹配策略：优先选择歌名与关键词高度相似的候选，
 * 避免匹配到翻唱或无关歌曲。
 */
export async function findLyric(keyword: string): Promise<LyricResult> {
  const kw = keyword.trim()
  if (!kw) {
    return { found: false, lines: [], hasTranslation: false, message: '关键词为空' }
  }

  const songs = await searchSongs(kw)
  if (songs.length === 0) {
    return {
      found: false,
      lines: [],
      hasTranslation: false,
      message: `网易云未找到「${kw}」`,
    }
  }

  // 选最佳匹配：歌名与关键词的相似度优先，其次保持搜索原始排序
  const norm = (s: string) =>
    s.toLowerCase().replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '')

  const target = norm(kw)
  let best = songs[0]
  let bestScore = -1

  for (const s of songs) {
    const n = norm(s.name)
    let score = 0
    if (n === target) score = 100
    else if (n.includes(target) || target.includes(n)) score = 60
    // 越靠前的结果给一点加权
    score -= songs.indexOf(s) * 0.5
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }

  const { lrc, tlyric } = await fetchLyricById(best.id)

  if (!lrc.trim()) {
    return {
      found: false,
      song: {
        id: best.id,
        name: best.name,
        artist: (best.artists || []).map((a) => a.name).join('/'),
      },
      lines: [],
      hasTranslation: false,
      message: '这首歌暂无歌词',
    }
  }

  const original = parseLrc(lrc)
  const translation = parseLrc(tlyric)
  const lines = mergeTranslation(original, translation)

  return {
    found: true,
    song: {
      id: best.id,
      name: best.name,
      artist: (best.artists || []).map((a) => a.name).join('/'),
    },
    lines,
    hasTranslation: lines.some((l) => l.translation),
  }
}
