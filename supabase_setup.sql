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

-- ── 已上线生产表补列（幂等，可安全重复执行）──────────────────
-- 2026-08-12 第二阶段"灵气兑换水晶"：用户用游戏内积分（灵气）兑换实体水晶商品，
-- 纯展示+外链，业务方线下通过WhatsApp联系买家发货，本次不做app内真实收款。
-- spirit_balance 是用户当前灵气余额（前端 js/user-state.js 读写同步）。
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS spirit_balance INTEGER DEFAULT 0;

-- ── 兑换请求记录表 ──────────────────────────────────────────
-- 2026-08-12 第二阶段"灵气兑换水晶"：用户提交一次兑换请求时由前端直接
-- insert 一行（不经过后端写库，后端 /notify-redemption 端点只负责发一封
-- 提醒邮件，这张表才是权威数据）。不给用户 UPDATE/DELETE 策略，状态流转
-- （pending → contacted → shipped → done/cancelled）由业务方在 Supabase
-- Studio 手动改，本阶段不建管理界面。
CREATE TABLE IF NOT EXISTS redemption_requests (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    product_id    TEXT NOT NULL,
    product_name  TEXT,
    spirit_cost   INTEGER,
    island_id     UUID REFERENCES islands(id) ON DELETE SET NULL,
    trait_kind    TEXT,
    trait_index   INTEGER,
    trait_summary TEXT,
    contact_phone TEXT,
    contact_note  TEXT,
    status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','contacted','shipped','done','cancelled')),
    fulfilled_at  TIMESTAMPTZ
);

-- ── 行级安全策略（RLS）──────────────────────────────────────
-- 用户只能创建/读取自己的兑换请求，不给 UPDATE/DELETE（见上方表注释）

ALTER TABLE redemption_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户只能创建自己的兑换请求" ON redemption_requests;
CREATE POLICY "用户只能创建自己的兑换请求"
    ON redemption_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "用户只能读取自己的兑换请求" ON redemption_requests;
CREATE POLICY "用户只能读取自己的兑换请求"
    ON redemption_requests FOR SELECT
    USING (auth.uid() = user_id);

-- 防止同一条命盘特点（caution）被重复兑换：同一用户+同一岛屿+同一
-- trait_kind/trait_index 只允许存在一条非 cancelled 的记录，否则会产生
-- 多笔灵气重复扣减、业务方重复收到通知的脏数据（cancelled 状态不受限，
-- 允许用户在被业务方取消后重新发起兑换）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_redemption_unique_trait
    ON redemption_requests(user_id, island_id, trait_kind, trait_index)
    WHERE status != 'cancelled';
