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

-- ── 已上线生产表补列（幂等，可安全重复执行）──────────────────
-- AI深析六步命理框架结果（完整JSON：step1_foundation ~ step6_dayun_liunian + keywords）
-- 允许为空：保存岛屿（写入model_url）与AI深析生成完成不一定同步，
-- 3D模型先入库，AI深析结果跑完后再补写这一列
ALTER TABLE islands ADD COLUMN IF NOT EXISTS ai_analysis JSONB;

-- ── 行级安全策略（RLS）──────────────────────────────────────
-- 用户只能看到自己的岛屿

ALTER TABLE islands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户只能读取自己的岛屿" ON islands;
CREATE POLICY "用户只能读取自己的岛屿"
    ON islands FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "用户只能创建自己的岛屿" ON islands;
CREATE POLICY "用户只能创建自己的岛屿"
    ON islands FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "用户只能更新自己的岛屿" ON islands;
CREATE POLICY "用户只能更新自己的岛屿"
    ON islands FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "用户只能删除自己的岛屿" ON islands;
CREATE POLICY "用户只能删除自己的岛屿"
    ON islands FOR DELETE
    USING (auth.uid() = user_id);

-- ── 索引（加速查询）────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_islands_user_id ON islands(user_id);
CREATE INDEX IF NOT EXISTS idx_islands_bazi_hash ON islands(bazi_hash);

-- ── 用户资料表 ──────────────────────────────────────────────
-- 对应 js/auth.js 的 registerWithProfile() / getProfile()
-- 主键即 auth.users 的 id（一对一），不是单独的 user_id 外键列
CREATE TABLE IF NOT EXISTS profiles (
    id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    display_name TEXT,
    country      TEXT DEFAULT 'CN',
    phone_code   TEXT DEFAULT '+86',
    phone        TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 行级安全策略（RLS）──────────────────────────────────────
-- 用户只能读写自己的资料；注意条件是 auth.uid() = id（表主键本身就是 user id）

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户只能读取自己的资料" ON profiles;
CREATE POLICY "用户只能读取自己的资料"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "用户只能创建自己的资料" ON profiles;
CREATE POLICY "用户只能创建自己的资料"
    ON profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "用户只能更新自己的资料" ON profiles;
CREATE POLICY "用户只能更新自己的资料"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "用户只能删除自己的资料" ON profiles;
CREATE POLICY "用户只能删除自己的资料"
    ON profiles FOR DELETE
    USING (auth.uid() = id);
