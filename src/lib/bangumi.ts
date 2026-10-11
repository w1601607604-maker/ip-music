/**
 * Bangumi API 封装
 *
 * 文档：https://github.com/bangumi/api/blob/master/open-api/v0.yaml
 *
 * 注意：Bangumi 强制要求 User-Agent 请求头，否则可能被拒绝。
 */

import type {
  Paged,
  UserCollection,
  WorkItem,
  SubjectImages,
} from './types'

/** Bangumi API 基址，可通过环境变量覆盖（便于测试或自建镜像） */
const BANGUMI_API = process.env.BANGUMI_API_BASE || 'https://api.bgm.tv'

/** Bangumi 要求带上可识别的 User-Agent */
const USER_AGENT =
  process.env.BANGUMI_USER_AGENT ||
  'ip-music/0.1 (https://github.com/ip-music; contact@example.com)'

/** Bangumi 单次请求最大条数 */
export const MAX_LIMIT = 50

export class BangumiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'BangumiError'
  }
}

/**
 * 拉取用户收藏列表
 *
 * @param username Bangumi 用户名（如 `sai`）
 * @param opts.subjectType 条目类型筛选（1/2/3/4/6）
 * @param opts.collectionType 收藏状态筛选（1~5）
 * @param opts.limit 每页条数，最大 50
 * @param opts.offset 偏移量
 */
export async function fetchUserCollections(
  username: string,
  opts: {
    subjectType?: number
    collectionType?: number
    limit?: number
    offset?: number
  } = {},
): Promise<Paged<UserCollection>> {
  const { subjectType, collectionType, limit = MAX_LIMIT, offset = 0 } = opts

  const params = new URLSearchParams()
  if (subjectType) params.set('subject_type', String(subjectType))
  if (collectionType) params.set('type', String(collectionType))
  params.set('limit', String(Math.min(limit, MAX_LIMIT)))
  params.set('offset', String(offset))

  const url = `${BANGUMI_API}/v0/users/${encodeURIComponent(username)}/collections?${params}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      // 收藏数据变化不频繁，缓存 5 分钟。
      // 用标准 Cache-Control 而非 next.revalidate，以兼容 Edge Runtime。
      cf: { cacheTtl: 300, cacheEverything: true },
      next: { revalidate: 300 },
    } as RequestInit)
  } catch (e) {
    // 区分 DNS 解析失败与其他网络错误，便于定位问题
    const cause = (e as any)?.cause
    const code = cause?.code || (e as any)?.code || ''
    const msg = String((e as any)?.message || e)

    if (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      msg.includes('ENOTFOUND') ||
      msg.includes('EAI_AGAIN')
    ) {
      throw new BangumiError(
        'DNS 解析 api.bgm.tv 失败。若你使用了自定义 DNS 或代理，请检查其是否污染了该域名',
        502,
      )
    }

    if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || msg.includes('timed out')) {
      throw new BangumiError(
        '连接 api.bgm.tv 超时。可能是网络环境限制或需要代理',
        502,
      )
    }

    throw new BangumiError(`无法连接 Bangumi：${msg}`, 502)
  }

  if (res.status === 404) {
    throw new BangumiError(`用户「${username}」不存在`, 404)
  }

  if (!res.ok) {
    throw new BangumiError(
      `Bangumi 返回错误（HTTP ${res.status}）`,
      res.status,
    )
  }

  const json = (await res.json()) as Paged<UserCollection>

  // 防御：接口异常时可能不返回 data
  if (!json || !Array.isArray(json.data)) {
    throw new BangumiError('Bangumi 返回数据格式异常')
  }

  return json
}

/** 把 Bangumi 收藏项归一化成前端用的 WorkItem */
export function toWorkItem(c: UserCollection): WorkItem {
  const s = c.subject
  const nameCn = s?.name_cn?.trim() || ''
  const nameOriginal = s?.name?.trim() || ''
  return {
    id: c.subject_id,
    // 优先中文名，回退原名
    name: nameCn || nameOriginal || `条目 #${c.subject_id}`,
    nameCn: s?.name_cn,
    // 原名（通常是日文），用于在网易云搜索时补充关键词
    // 例：命运石之门 → STEINS;GATE，中文名在网易云搜不到
    nameOriginal: nameOriginal || undefined,
    cover: s?.images?.common || s?.images?.medium || s?.images?.large,
    subjectType: c.subject_type,
    collectionType: c.type,
    rate: c.rate,
  }
}

/** Bangumi 关联条目（/v0/subjects/{id}/subjects 的返回项） */
export interface RelatedSubject {
  id: number
  type: number
  name: string
  name_cn?: string
  /** 关联关系，如「原声集」「片头曲」等 */
  relation?: string
  images?: SubjectImages
}

/**
 * 拉取作品的关联条目。
 *
 * 用途：找到作品的关联音乐条目（subject_type=3），
 * 用这些专辑名去网易云搜索，能覆盖到中文译名搜不到的内容。
 *
 * 例如「少女歌剧 黄金国」这类译名特殊的游戏，直接搜作品名
 * 在网易云几乎搜不到，但通过关联音乐条目就能找到对应 OST。
 *
 * @param subjectId Bangumi 条目 id
 */
export async function fetchRelatedSubjects(
  subjectId: number,
): Promise<RelatedSubject[]> {
  const res = await fetch(`${BANGUMI_API}/v0/subjects/${subjectId}/subjects`, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12000),
  })

  if (!res.ok) {
    // 关联条目属于增强信息，失败不应阻断主流程
    throw new BangumiError(
      `获取关联条目失败（HTTP ${res.status}）`,
      res.status,
    )
  }

  const json = await res.json()
  // 接口可能返回数组，也可能包在 data 字段里
  const list = Array.isArray(json) ? json : (json?.data ?? [])
  return Array.isArray(list) ? list : []
}

/**
 * 获取作品的关联音乐条目名称。
 *
 * 只返回 subject_type=3（音乐）的条目名，用于补充网易云搜索关键词。
 * 最多返回若干个，避免请求过多。
 */
export async function fetchRelatedMusicNames(
  subjectId: number,
  max = 6,
): Promise<string[]> {
  try {
    const related = await fetchRelatedSubjects(subjectId)
    const names: string[] = []

    for (const r of related) {
      if (r?.type !== 3) continue // 3 = 音乐
      // 优先原名（专辑名通常是日文/英文），其次中文名
      const n = (r.name || '').trim() || (r.name_cn || '').trim()
      if (n && !names.includes(n)) names.push(n)
      if (names.length >= max) break
    }

    return names
  } catch {
    // 关联条目拿不到时静默降级，不影响主流程
    return []
  }
}
