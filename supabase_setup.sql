-- 司马八字 · 用户数据表初始化 SQL
-- 在 Supabase 控制台 → SQL Editor 中执行一次

-- ── 用户岛屿记录表 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS islands (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),

    -- 生辰信息（明文，用于显示）
    birth_year  INTEGER,
    birth_month INTEGER,
    birth_day   INTEGER,
    birth_hour  INTEGER,
    gender      TEXT CHECK (gender IN ('男', '女')),

    -- 八字计算结果（完整JSON，用于重新生成）
    bazi_data   JSONB,

    -- 生成结果
    model_url   TEXT,           -- GLB 3D模型 URL
    bazi_hash   TEXT,           -- MD5 hash，用于命中缓存

    -- 用户自定义
    name        TEXT DEFAULT '我的命盘岛屿'
);

-- ── 行级安全策略（RLS）──────────────────────────────────────
-- 用户只能看到自己的岛屿

ALTER TABLE islands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能读取自己的岛屿"
    ON islands FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "用户只能创建自己的岛屿"
    ON islands FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户只能更新自己的岛屿"
    ON islands FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "用户只能删除自己的岛屿"
    ON islands FOR DELETE
    USING (auth.uid() = user_id);

-- ── 索引（加速查询）────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_islands_user_id ON islands(user_id);
CREATE INDEX IF NOT EXISTS idx_islands_bazi_hash ON islands(bazi_hash);
