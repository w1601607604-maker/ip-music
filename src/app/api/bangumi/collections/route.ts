import { NextRequest, NextResponse } from 'next/server'
import {
  fetchUserCollections,
  toWorkItem,
  BangumiError,
  MAX_LIMIT,
} from '@/lib/bangumi'

export const runtime = 'nodejs'

/**
 * GET /api/bangumi/collections
 *
 * 查询参数：
 *   username    - Bangumi 用户名（必填）
 *   subjectType - 条目类型 1/2/3/4/6（可选）
 *   type        - 收藏状态 1~5（可选）
 *   limit       - 每页条数，最大 50（默认 50）
 *   offset      - 偏移量（默认 0）
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const username = sp.get('username')?.trim()
  if (!username) {
    return NextResponse.json({ error: '请提供 Bangumi 用户名' }, { status: 400 })
  }

  // 用户名合法性：Bangumi 用户名只含字母数字下划线连字符
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(username)) {
    return NextResponse.json(
      { error: '用户名格式不正确（只允许字母、数字、下划线、连字符）' },
      { status: 400 },
    )
  }

  const subjectType = sp.get('subjectType')
    ? Number(sp.get('subjectType'))
    : undefined
  const collectionType = sp.get('type') ? Number(sp.get('type')) : undefined
  const limit = Math.min(Number(sp.get('limit')) || MAX_LIMIT, MAX_LIMIT)
  const offset = Number(sp.get('offset')) || 0

  try {
    const paged = await fetchUserCollections(username, {
      subjectType,
      collectionType,
      limit,
      offset,
    })

    return NextResponse.json({
      total: paged.total,
      limit: paged.limit,
      offset: paged.offset,
      data: paged.data.map(toWorkItem),
    })
  } catch (e) {
    if (e instanceof BangumiError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status && e.status >= 400 ? e.status : 502 },
      )
    }
    console.error('[api/bangumi/collections]', e)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
