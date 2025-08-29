/**
 * API Types for Payload CMS
 */

export interface WhereClause {
  [key: string]: string | number | boolean | (string | number)[] | WhereClause[] | undefined
  equals?: string | number | boolean
  in?: (string | number)[]
  contains?: string
  or?: WhereClause[]
}

export interface PopulateClause {
  [key: string]: boolean | PopulateClause
}

export interface PaginationInfo {
  page: number
  totalPages: number
  totalDocs: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface ContentResponse<T> {
  success: boolean
  error?: string
  docs?: T[]
  pagination?: PaginationInfo
}

export interface BlockDocument {
  id: string
  externalId: string
  url: string
  title?: string
  description?: string
  sourceType: 'home' | 'pop' | 'user'
  mediaType?: 'image' | 'video' | 'gif' | 'unknown'
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
  originalSourceUrl?: string
  status: 'pending' | 'fetched' | 'scraped' | 'uploaded' | 'error'
  tags?: Array<{ tag: string }>
  aiTags?: Array<{ tag: string; confidence: number }>
  colorPalette?: Array<{ hex: string; percentage: number }>
  metadata?: Record<string, string | number | boolean | null>
  r2Key?: string
  errorMessage?: string
  viewCount: number
  isPublished: boolean
  source?: SourceDocument
  userProfile?: UserProfileDocument
  run?: RunDocument
  createdAt: string
  updatedAt: string
}

export interface SourceDocument {
  id: string
  url: string
  sourceType: 'home' | 'pop' | 'user'
  userProfile?: string | UserProfileDocument
  kind: 'manual' | 'scheduled'
  maxItems: number
  status: 'active' | 'paused' | 'completed' | 'error'
  lastScrapedAt?: string
  createdAt: string
  updatedAt: string
}

export interface UserProfileDocument {
  id: string
  username: string
  displayName?: string
  profileUrl?: string
  bio?: string
  avatarUrl?: string
  isActive: boolean
  totalBlocks: number
  lastScrapedAt?: string
  metadata?: Record<string, string | number | boolean | null>
  tags?: Array<{ tag: string }>
  createdAt: string
  updatedAt: string
}

export interface RunDocument {
  id: string
  source: string | SourceDocument
  kind: 'manual' | 'scheduled'
  status: 'pending' | 'running' | 'paused' | 'completed' | 'error'
  counters: {
    found: number
    uploaded: number
    errors: number
  }
  startedAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface LogEntry {
  id: string
  timestamp: string
  type: 'STARTING' | 'FETCH' | 'SCRAPE' | 'COMPLETE' | 'UPLOAD' | 'ERROR'
  message: string
  details?: {
    progress?: number
    total?: number
    url?: string
    [key: string]: string | number | boolean | null | undefined
  }
}

export interface JobData {
  id: string
  source: {
    url: string
    maxItems: number
  }
  status: string
  counters: {
    found: number
    uploaded: number
    errors: number
  }
  createdAt: string
}
