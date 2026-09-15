/**
 * 运行状态：记录已推送过的论文 / 新闻、任务完成时间、早报快照。
 * 这份文件会被 GitHub Actions 提交回仓库，既是去重依据，也让仓库保持活跃
 * （GitHub 会停用 60 天无活动的定时工作流）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { DATA_DIR, STATE_FILE } from './config.mjs';

const EMPTY = {
  version: 1,
  lastMorningDate: null,
  lastEveningDate: null,
  seenPaperIds: [],
  seenNewsIds: [],
  completedAt: {},
  morningSnapshot: null,
  updatedAt: null,
};

export function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    return { ...structuredClone(EMPTY), ...parsed };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveState(state) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  state.updatedAt = new Date().toISOString();
  // 去重列表做上界，避免文件无限增长
  state.seenPaperIds = (state.seenPaperIds || []).slice(-600);
  state.seenNewsIds = (state.seenNewsIds || []).slice(-600);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}
