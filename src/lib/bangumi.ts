/**
 * Bangumi API 封装
 *
 * 文档：https://github.com/bangumi/api/blob/master/open-api/v0.yaml
 *
 * 注意：Bangumi 强制要求 User-Agent 请求头，否则可能被拒绝。
 */

import type { Paged, UserCollection, WorkItem } from './types'

const BANGUMI_API = 'https://api.bgm.tv'

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
      // 收藏数据变化不频繁，缓存 5 分钟
      next: { revalidate: 300 },
    })
  } catch (e) {
    throw new BangumiError(
      '无法连接 Bangumi，请检查网络（部分地区可能需要代理）',
    )
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
  return {
    id: c.subject_id,
    // 优先中文名，回退原名
    name: s?.name_cn?.trim() || s?.name || `条目 #${c.subject_id}`,
    nameCn: s?.name_cn,
    cover: s?.images?.common || s?.images?.medium || s?.images?.large,
    subjectType: c.subject_type,
    collectionType: c.type,
    rate: c.rate,
  }
}
