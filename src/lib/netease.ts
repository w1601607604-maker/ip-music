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
  // 匿名访客 Cookie：降低被判定为爬虫的概率（无需登录）
  Cookie: 'os=pc; appver=2.9.7; NMTID=00Oxxx; _ntes_nuid=00000000000000000000000000000000',
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
  /** 旧接口 /search/get/web 的字段 */
  artists?: { name: string }[]
  album?: { name: string }
  duration?: number
  /** 新接口 /cloudsearch/pc 的字段 */
  ar?: { name: string }[]
  al?: { name: string }
  dt?: number
  /** 热度 0~100，仅 cloudsearch 提供 */
  pop?: number
  /** 付费类型：0=免费 1=VIP 4=购买专辑 8=低音质免费 */
  fee?: number
}

/** 搜索结果条目（给前端用） */
export interface NeteaseSongItem {
  id: number
  name: string
  artist: string
  album: string
  duration: number
  /** 热度 0~100，用于排序；旧接口无此字段时为 0 */
  popularity: number
  /** 付费类型：0=免费 1=VIP 4=购买专辑 8=低音质免费 */
  fee: number
}

/** 把网易云原始歌曲对象转成前端条目（兼容两个接口的字段差异） */
function toSongItem(s: NeteaseSong): NeteaseSongItem {
  const artists = s.ar || s.artists || []
  return {
    id: s.id,
    name: s.name || '',
    artist: artists.map((a) => a.name).join(' / '),
    album: s.al?.name || s.album?.name || '',
    duration: s.dt || s.duration || 0,
    popularity: typeof s.pop === 'number' ? s.pop : 0,
    fee: typeof s.fee === 'number' ? s.fee : 0,
  }
}

/**
 * 按作品名搜索网易云歌曲列表。
 *
 * 这是新的主链路第一步：作品名 → 网易云曲目列表。
 *
 * 相比直接搜 B站，网易云返回的是**真实曲目元数据**（曲名/歌手/专辑），
 * 而不是视频标题，信息更准确，也不受 B站风控影响。
 *
 * 搜索策略（两路合并，覆盖更全）：
 *   路线 A —— 歌曲搜索：直接搜曲名，能拿到热门单曲
 *   路线 B —— 专辑搜索：搜 OST 专辑，再拉取专辑内全部曲目
 *
 * 为什么需要路线 B：
 *   只搜歌曲时，网易云按曲名匹配，会漏掉大量 OST 曲目
 *   （例如 CLANNAD 只搜歌曲得 74 首，但 OST 专辑本身就有 56 首，
 *   加上其他专辑共 200+ 首）。专辑路线能显著提升覆盖度。
 *
 * @param workName 作品名（通常是中文名）
 * @param limit 每个关键词取多少条
 */
export async function searchSongsForWork(
  workName: string,
  limit = 30,
  altName?: string,
  relatedNames: string[] = [],
): Promise<NeteaseSongItem[]> {
  const name = workName.trim()
  if (!name) return []

  // 备用名（通常是日文原名），用于补充搜索
  // 例：命运石之门 → STEINS;GATE，中文名在网易云搜不到对应 OST
  const alt = altName?.trim() || ''
  const hasAlt = alt.length > 0 && alt !== name

  const seen = new Set<number>()
  const merged: NeteaseSongItem[] = []
  let lastError: unknown = null

  const addSongs = (songs: NeteaseSong[]) => {
    for (const s of songs) {
      if (!s?.id || seen.has(s.id)) continue
      seen.add(s.id)
      merged.push(toSongItem(s))
    }
  }

  /**
   * 判断曲目是否与作品相关。
   *
   * 背景：网易云按关键词模糊匹配，可能返回无关曲目
   * （搜 CLANNAD 会混入《花千骨》原声带、《Outer Wilds》OST）。
   *
   * 但不能一律用「名称包含」来过滤 —— 中文作品名对应的曲目/专辑
   * 往往是日文或英文（命运石之门 → STEINS;GATE），会被误杀。
   *
   * 折中策略：
   *   - 专辑名包含作品名 → 相关
   *   - 曲名包含作品名 → 相关
   *   - 作品名是纯 ASCII（如 CLANNAD）→ 启用严格过滤，
   *     因为这类名称在日文/英文曲目里通常也会出现
   *   - 作品名含中文 → 放宽（无法据此判断，交给网易云的相关度排序）
   */
  const isRelevant = (s: NeteaseSong): boolean => {
    const songName = normalizeName(s.name || '')
    const albumName = normalizeName(s.al?.name || s.album?.name || '')
    if (!songName && !albumName) return false

    // 收集所有可用于匹配的名称变体
    const variants: string[] = []
    for (const raw of [name, alt, ...relatedNames]) {
      const v = normalizeName(raw)
      if (v) variants.push(v)
      // 去掉副标题再试一次
      // 例：时钟机关的Ley-line-朝雾中飘零之花- → 时钟机关的leyline
      const base = normalizeName(stripSubtitle(raw))
      if (base && base !== v) variants.push(base)
    }

    if (variants.length === 0) return true

    for (const v of variants) {
      // 1. 名称直接包含
      if (songName.includes(v) || albumName.includes(v)) return true

      // 2. 最长公共子串 —— 应对译名/假名差异
      //    阈值随名称长度自适应：长名要求更高，短名放宽
      const need = v.length <= 4 ? v.length : Math.max(3, Math.ceil(v.length * 0.5))
      if (longestCommonSubstring(v, albumName) >= need) return true
      if (longestCommonSubstring(v, songName) >= need) return true
    }

    return false
  }

  /** 最长公共子串长度，用于判断名称相似度 */
  function longestCommonSubstring(a: string, b: string): number {
    if (!a || !b) return 0
    let best = 0
    let prev = new Array<number>(b.length + 1).fill(0)
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array<number>(b.length + 1).fill(0)
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) {
          cur[j] = prev[j - 1] + 1
          if (cur[j] > best) best = cur[j]
        }
      }
      prev = cur
    }
    return best
  }

  const addRelevantSongs = (songs: NeteaseSong[]) => {
    for (const s of songs) {
      if (!s?.id || seen.has(s.id)) continue
      // 专辑路线来的曲目已确认相关，歌曲路线需要过滤
      if (!isRelevant(s)) continue
      seen.add(s.id)
      merged.push(toSongItem(s))
    }
  }

  // ---- 路线 A：歌曲搜索（多个关键词）----
  const baseName = stripSubtitle(name)
  const songQueries = [`${name} OST`, `${name} 原声`, name]
  // 去掉副标题的主标题（系列作常见：时钟机关的Ley-line-朝雾中飘零之花-）
  if (baseName && baseName !== name) {
    songQueries.push(`${baseName} OST`, baseName)
  }
  if (hasAlt) {
    songQueries.push(`${alt} OST`, `${alt} 原声`, alt)
    const baseAlt = stripSubtitle(alt)
    if (baseAlt && baseAlt !== alt) songQueries.push(baseAlt)
  }
  // Bangumi 关联音乐条目名（OST 专辑名），能覆盖译名搜不到的情况
  for (const rn of relatedNames.slice(0, 4)) {
    const r = rn.trim()
    if (r && r !== name && r !== alt) songQueries.push(r)
  }
  for (const q of songQueries) {
    try {
      addRelevantSongs(await searchSongs(q, limit))
    } catch (e) {
      lastError = e
    }
    await new Promise((r) => setTimeout(r, 120))
  }

  // ---- 路线 B：专辑搜索 → 拉取专辑曲目 ----
  try {
    const albums = await searchAlbums(name, 8)
    // 只取与作品名相关的专辑（避免搜到同名无关专辑）
    const relevant = albums.filter((a) => isRelevantAlbum(a.name, name))

    // 用去副标题的主标题搜专辑（系列作常见）
    if (baseName && baseName !== name) {
      try {
        const baseAlbums = await searchAlbums(baseName, 6)
        for (const a of baseAlbums) {
          if (
            isRelevantAlbum(a.name, baseName) &&
            !relevant.some((x) => x.id === a.id)
          ) {
            relevant.push(a)
          }
        }
      } catch {
        // 忽略
      }
    }

    // 用原名再搜一轮专辑（应对译名差异）
    if (hasAlt) {
      try {
        const altAlbums = await searchAlbums(alt, 8)
        for (const a of altAlbums) {
          if (isRelevantAlbum(a.name, alt) && !relevant.some((r) => r.id === a.id)) {
            relevant.push(a)
          }
        }
      } catch {
        // 原名搜索失败不影响整体
      }
    }

    // 用 Bangumi 关联音乐条目名搜专辑（覆盖译名差异）
    for (const rn of relatedNames.slice(0, 4)) {
      const r = rn.trim()
      if (!r || r === name || r === alt) continue
      try {
        const relAlbums = await searchAlbums(r, 6)
        for (const a of relAlbums) {
          if (
            isRelevantAlbum(a.name, r) &&
            !relevant.some((x) => x.id === a.id)
          ) {
            relevant.push(a)
          }
        }
      } catch {
        // 单个关键词失败不影响整体
      }
      await new Promise((res) => setTimeout(res, 120))
    }

    for (const album of relevant.slice(0, 5)) {
      try {
        addSongs(await fetchAlbumSongs(album.id))
      } catch {
        // 单个专辑失败不影响整体
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  } catch (e) {
    lastError = lastError ?? e
  }

  // 一条都没有且确实出过错 → 抛出真实原因，不要伪装成"未找到"
  if (merged.length === 0 && lastError) {
    throw lastError instanceof NeteaseError
      ? lastError
      : new NeteaseError(
          `网易云搜索失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
        )
  }

  // 排序：热度优先，热度相同时按「可播放性 + 曲名长度」细分
  //
  // 说明：网易云的 pop 值大量集中在 100，仅按 pop 排序时
  // 同分曲目的顺序取决于搜索返回顺序，看起来像"没排序"。
  // 因此加入次级排序键：
  //   1. 可免费播放的优先（fee=1 为 VIP 专属，排后面）
  //   2. 曲名较短的优先（通常是原曲，而非「XX Ver.」「XX Remix」）
  merged.sort((a, b) => {
    if (b.popularity !== a.popularity) return b.popularity - a.popularity
    const aVip = a.fee === 1 ? 1 : 0
    const bVip = b.fee === 1 ? 1 : 0
    if (aVip !== bVip) return aVip - bVip
    return a.name.length - b.name.length
  })

  return merged
}

/** 网易云专辑条目 */
interface NeteaseAlbum {
  id: number
  name: string
  size?: number
}


/**
 * 去掉名称中的副标题。
 *
 * Bangumi 的条目名常带副标题，例如：
 *   时钟机关的Ley-line-朝雾中飘零之花-
 *   剧场版 空之境界 第三章 痛觉残留
 * 而网易云的专辑名只含主标题（時計仕掛けのレイライン）。
 * 因此匹配前先剥离副标题，提高命中率。
 */
function stripSubtitle(s: string): string {
  let out = s.trim()
  // 去掉「剧场版」「TV动画」等前缀
  out = out.replace(/^(剧场版|劇場版|TV动画|TVアニメ|动画|アニメ|映画)\s*/i, '')
  // 去掉破折号/冒号后的副标题
  out = out.split(/[-–—:：~～]/)[0]
  // 去掉「第X章」「第X季」等章节标记
  out = out.replace(/第[一二三四五六七八九十\d]+[章季部篇话]/g, '')
  return out.trim()
}

/**
 * 常用繁体 → 简体映射表。
 *
 * 用途：Bangumi 用简体中文（少女歌剧），网易云多用日文汉字/繁体
 * （少女☆歌劇），直接比较会全部失配，导致搜索结果被误过滤。
 *
 * 只收录标题中高频出现的字，避免引入体积较大的转换库。
 */
const T2S_MAP: Record<string, string> = {
  劇: '剧', 歌: '歌', 聲: '声', 樂: '乐', 點: '点', 擊: '击',
  發: '发', 動: '动', 機: '机', 關: '关', 於: '于', 與: '与',
  為: '为', 這: '这', 個: '个', 來: '来', 時: '时', 說: '说',
  對: '对', 開: '开', 會: '会', 後: '后', 沒: '没', 樣: '样',
  麼: '么', 學: '学', 園: '园', 國: '国', 語: '语', 話: '话',
  電: '电', 視: '视', 畫: '画', 漫: '漫', 戰: '战', 記: '记',
  憶: '忆', 夢: '梦', 想: '想', 戀: '恋', 愛: '爱', 情: '情',
  熱: '热', 風: '风', 雲: '云', 雨: '雨', 雪: '雪', 花: '花',
  鳥: '鸟', 魚: '鱼', 龍: '龙', 鳳: '凤', 魔: '魔', 法: '法',
  師: '师', 劍: '剑', 騎: '骑', 士: '士', 勇: '勇', 者: '者',
  傳: '传', 統: '统', 結: '结', 束: '束', 終: '终', 極: '极',
  限: '限', 界: '界', 世: '世', 紀: '纪', 元: '元', 復: '复',
  興: '兴', 甦: '苏', 醒: '醒', 覺: '觉', 眠: '眠', 闇: '暗',
  黒: '黑', 白: '白', 赤: '赤', 青: '青', 黃: '黄', 綠: '绿',
  紫: '紫', 銀: '银', 鋼: '钢', 鉄: '铁', 空: '空', 海: '海',
  星: '星', 月: '月', 陽: '阳', 光: '光', 影: '影', 響: '响',
  音: '音', 曲: '曲', 詩: '诗', 詞: '词', 繪: '绘', 圖: '图',
  書: '书', 館: '馆', 室: '室', 家: '家', 族: '族', 兄: '兄',
  弟: '弟', 姉: '姐', 妹: '妹', 娘: '娘', 子: '子', 供: '供',
  達: '达', 們: '们', 誰: '谁', 何: '何', 處: '处', 所: '所',
  無: '无', 有: '有', 全: '全', 部: '部', 分: '分', 半: '半',
  數: '数', 量: '量', 質: '质', 變: '变', 化: '化', 進: '进',
  行: '行', 退: '退', 出: '出', 入: '入', 上: '上', 下: '下',
  前: '前', 左: '左', 右: '右', 内: '内', 外: '外',
}

/** 繁体转简体（仅处理映射表内的字） */
function toSimplified(s: string): string {
  let out = ''
  for (const ch of s) {
    out += T2S_MAP[ch] ?? ch
  }
  return out
}

/** 归一化：繁转简 → 转小写 → 去符号空白 */
function normalizeName(s: string): string {
  return toSimplified(s)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * 判断专辑名是否与作品名相关。
 *
 * 网易云专辑搜索会返回一些同名但无关的专辑，需要过滤。
 * 规则：专辑名包含作品名（繁简归一后）即视为相关。
 */
function isRelevantAlbum(albumName: string, workName: string): boolean {
  const a = normalizeName(albumName)
  const w = normalizeName(workName)
  if (!a || !w) return false
  return a.includes(w)
}

/**
 * 搜索网易云专辑（type=10）。
 *
 * 用于路线 B：先找到 OST 专辑，再拉取专辑内全部曲目，
 * 这样能覆盖到只搜曲名时漏掉的曲目。
 */
export async function searchAlbums(
  keyword: string,
  limit = 8,
): Promise<NeteaseAlbum[]> {
  const params = new URLSearchParams({
    s: keyword,
    type: '10',
    offset: '0',
    limit: String(limit),
  })

  const res = await fetch(`${NETEASE}/api/cloudsearch/pc?${params}`, {
    headers: HEADERS,
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  })

  if (!res.ok) {
    throw new NeteaseError(`网易云专辑搜索失败（HTTP ${res.status}）`)
  }

  const json = await res.json()
  if (json?.code === 405) {
    throw new NeteaseError('操作频繁（405）')
  }

  const albums: NeteaseAlbum[] = json?.result?.albums || []
  return albums
}

/**
 * 获取专辑内的全部曲目。
 *
 * 注意：必须用 /api/v1/album/{id}，旧版 /api/album/{id} 返回空数组。
 */
export async function fetchAlbumSongs(albumId: number): Promise<NeteaseSong[]> {
  const res = await fetch(`${NETEASE}/api/v1/album/${albumId}`, {
    headers: HEADERS,
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  })

  if (!res.ok) {
    throw new NeteaseError(`网易云专辑详情失败（HTTP ${res.status}）`)
  }

  const json = await res.json()
  const songs: NeteaseSong[] = json?.songs || []
  return songs
}

/**
 * 搜索网易云歌曲，返回候选列表。
 *
 * ⚠️ 限流说明（实测）：
 *   网易云搜索接口对无 Cookie 的请求限流严格，数据中心 IP 尤其容易
 *   触发 code=405「操作频繁，请稍候再试」。
 *
 *   应对：
 *     1. 带一组浏览器 Cookie（匿名即可，无需登录）
 *     2. 遇 405 时退避重试
 *     3. 主接口失败则换 /api/cloudsearch/pc 备用接口
 */
export async function searchSongs(
  keyword: string,
  limit = 10,
): Promise<NeteaseSong[]> {
  const params = new URLSearchParams({
    s: keyword,
    type: '1',
    offset: '0',
    limit: String(limit),
  })

  // 主接口用 cloudsearch（含热度 pop 字段，便于按热度排序）
  // 备用接口为旧的 search/get/web
  const endpoints = [
    `${NETEASE}/api/cloudsearch/pc?${params}`,
    `${NETEASE}/api/search/get/web?${params}`,
  ]

  let lastError: string | null = null

  for (const url of endpoints) {
    // 每个接口最多试 2 次（应对偶发 405）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: HEADERS,
          cache: 'no-store',
          signal: AbortSignal.timeout(12000),
        })

        if (!res.ok) {
          lastError = `HTTP ${res.status}`
          break // 换下一个接口
        }

        const json = await res.json()

        // 405 = 操作频繁，退避后重试
        if (json?.code === 405) {
          lastError = '操作频繁（405）'
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
          continue
        }

        const songs: NeteaseSong[] = json?.result?.songs || []
        if (songs.length > 0) return songs

        // 返回成功但无结果，不必重试
        if (json?.code === 200) return []
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
    }
  }

  // 全部失败：抛出真实原因（而不是静默返回空，导致前端显示"未找到"）
  throw new NeteaseError(
    `网易云搜索失败${lastError ? `：${lastError}` : ''}，请稍后重试`,
  )
}

/** 解析 LRC 文本为 [{time, text}] */
function parseLrc(lrc: string): { time: number; text: string }[] {
  if (!lrc) return []

  const out: { time: number; text: string }[] = []
  const lines = lrc.split('\n')

  // 有些歌词（尤其是翻唱/用户上传）完全没有 [mm:ss] 时间轴，是纯文本。
  // 这种情况按行顺序输出，时间戳用行号占位，保证歌词仍能显示。
  const hasAnyTimeTag = /\[\d{1,2}:\d{2}/.test(lrc)

  if (!hasAnyTimeTag) {
    return lines
      .map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
      // 过滤元信息行（作词/作曲/编曲等）
      .filter((t) => t && !/^(作词|作曲|编曲|混音|母带|制作人|出品|监制|录音|吉他|贝斯|鼓|键盘|和声|统筹|发行|策划|OP|SP)\s*[:：]/.test(t))
      .map((text, i) => ({ time: i * 1000, text }))
  }

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
 * 主入口（新链路）：直接用网易云歌曲 id 获取歌词。
 *
 * 前端已从曲目列表拿到 id，因此无需再搜索匹配，准确率 100%。
 *
 * @param songId 网易云歌曲 id
 * @param meta 可选的曲目信息（用于回显歌名/歌手）
 */
export async function findLyricById(
  songId: number,
  meta?: { name: string; artist: string },
): Promise<LyricResult> {
  const { lrc, tlyric } = await fetchLyricById(songId)

  const songInfo = meta
    ? { id: songId, name: meta.name, artist: meta.artist }
    : undefined

  if (!lrc.trim()) {
    return {
      found: false,
      song: songInfo,
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
    song: songInfo,
    lines,
    hasTranslation: lines.some((l) => l.translation),
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

  /** 翻唱/改编类噪声词：这些版本往往没有官方歌词，需降权 */
  const COVER_SIGNALS = [
    '翻自', '翻唱', 'cover', '改编', 'remix', '混音',
    '钢琴', 'piano', '吉他', 'guitar', '纯音乐', 'instrumental',
    '伴奏', '八音盒', 'music box', '口琴', '小提琴', 'violin',
    'dj', '加速版', '慢速版', '鬼畜', '恶搞',
  ]

  /** 给候选歌曲打分，分数越高越可能是"原曲" */
  function scoreSong(s: NeteaseSong, index: number): number {
    const n = norm(s.name)
    const nameLower = s.name.toLowerCase()
    let score = 0

    // 歌名相似度
    if (n === target) score += 100
    else if (n.includes(target) || target.includes(n)) score += 60
    else {
      // 部分词匹配：按共同字符比例给分
      const common = [...new Set(target)].filter((c) => n.includes(c)).length
      score += (common / Math.max(target.length, 1)) * 30
    }

    // 翻唱/改编降权
    for (const sig of COVER_SIGNALS) {
      if (nameLower.includes(sig)) score -= 45
    }

    // 歌名里带括号补充说明的，通常是翻唱或特殊版本
    if (/[（(].+[）)]/.test(s.name)) score -= 12

    // 越靠前的搜索结果给一点加权（网易云相关度排序）
    score -= index * 0.8

    return score
  }

  // 按分数排序候选，依次尝试直到找到有歌词的
  const ranked = songs
    .map((s, i) => ({ song: s, score: scoreSong(s, i) }))
    .sort((a, b) => b.score - a.score)

  let best = ranked[0].song
  let lrc = ''
  let tlyric = ''

  // 最多尝试前 3 个候选，避免匹配到无歌词的翻唱
  for (const { song } of ranked.slice(0, 3)) {
    const r = await fetchLyricById(song.id)
    if (r.lrc.trim()) {
      best = song
      lrc = r.lrc
      tlyric = r.tlyric
      break
    }
  }

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
