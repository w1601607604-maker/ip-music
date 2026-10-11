/** 共享类型定义 */

/** Bangumi 条目类型 */
export const SUBJECT_TYPE = {
  BOOK: 1,
  ANIME: 2,
  MUSIC: 3,
  GAME: 4,
  REAL: 6,
} as const

export type SubjectType = (typeof SUBJECT_TYPE)[keyof typeof SUBJECT_TYPE]

export const SUBJECT_TYPE_LABEL: Record<number, string> = {
  1: '书籍',
  2: '动画',
  3: '音乐',
  4: '游戏',
  6: '三次元',
}

/** Bangumi 收藏状态 */
export const COLLECTION_TYPE = {
  WISH: 1,
  COLLECT: 2,
  DOING: 3,
  ON_HOLD: 4,
  DROPPED: 5,
} as const

export const COLLECTION_TYPE_LABEL: Record<number, string> = {
  1: '想看',
  2: '看过',
  3: '在看',
  4: '搁置',
  5: '抛弃',
}

/** Bangumi 条目封面 */
export interface SubjectImages {
  large?: string
  common?: string
  medium?: string
  small?: string
  grid?: string
}

/** Bangumi 精简条目 */
export interface SlimSubject {
  id: number
  name: string
  name_cn?: string
  images?: SubjectImages
}

/** Bangumi 用户收藏项 */
export interface UserCollection {
  subject_id: number
  subject_type: number
  type: number
  rate: number
  ep_status?: number
  vol_status?: number
  updated_at?: string
  private?: boolean
  subject?: SlimSubject
}

/** 分页响应 */
export interface Paged<T> {
  total: number
  limit: number
  offset: number
  data: T[]
}

/** 前端使用的作品条目（已归一化） */
export interface WorkItem {
  id: number
  name: string
  nameCn?: string
  cover?: string
  subjectType: number
  collectionType: number
  rate: number
}

/** 网易云曲目条目（主链路第一步的结果） */
export interface SongItem {
  id: number
  name: string
  artist: string
  album: string
  duration: number
  /** 热度 0~100，用于展示与排序 */
  popularity: number
  /** 付费类型：0=免费 1=VIP 4=购买专辑 8=低音质免费 */
  fee: number
}

/** B站视频条目 */
export interface MusicItem {
  bvid: string
  title: string
  author: string
  cover?: string
  duration: number
  play: number
  /** 用于网易云歌词匹配的清洗后关键词 */
  keyword: string
}

/** 歌词行 */
export interface LyricLine {
  time: number
  text: string
  /** 对应翻译，可能为空 */
  translation?: string
}

/** 歌词响应 */
export interface LyricResult {
  found: boolean
  /** 匹配到的网易云歌曲信息 */
  song?: {
    id: number
    name: string
    artist: string
  }
  lines: LyricLine[]
  /** 是否有翻译 */
  hasTranslation: boolean
  /** 提示信息（如未找到） */
  message?: string
}

/** 统一 API 错误响应 */
export interface ApiError {
  error: string
  detail?: string
}
