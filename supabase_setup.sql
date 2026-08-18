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

-- ── 五行维护状态表 ──────────────────────────────────────────
-- 2026-08-15 第四阶段"五行经营机制"：记录用户对每一条五行问题
-- （wx × direction）的当前维护档位所需的全部状态。跟上面
-- redemption_requests"只增不改"的一次性记录不同，这张表会随
-- 拖拽维护/花灵气调理/水晶兑换/请神仙巩固等动作反复 UPDATE
-- （tier 本身是纯派生量，前端懒计算得出，不落库）。
-- 用 bazi_key（八字哈希）而不是 island_id 关联：岛屿模型可能因为
-- 重新生成 GLB 而产生新的 island_id，但用户在同一张命盘上积累的
-- 维护进度不应因此丢失，bazi_key 是跨岛屿记录稳定不变的锚点。
CREATE TABLE IF NOT EXISTS wuxing_maintenance_state (
    id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bazi_key               TEXT NOT NULL,
    wx                     TEXT NOT NULL,
    direction              TEXT NOT NULL CHECK (direction IN ('nourish','restrain')),
    base_tier              SMALLINT NOT NULL CHECK (base_tier BETWEEN 1 AND 3),
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    last_maintained_at     TIMESTAMPTZ,
    first_cycle_consumed   BOOLEAN DEFAULT FALSE,
    ownership_tier         TEXT NOT NULL DEFAULT 'none' CHECK (ownership_tier IN ('none','crystal','shrine')),
    ownership_product_id   TEXT,
    last_free_maintain_date DATE,
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- 同一用户对同一条命盘的同一条五行问题（wx+direction）只允许存在
-- 一条状态记录，多设备 upsert 时靠这个唯一索引做冲突目标。
CREATE UNIQUE INDEX IF NOT EXISTS idx_wuxing_maint_unique
    ON wuxing_maintenance_state(user_id, bazi_key, wx, direction);

-- ── 行级安全策略（RLS）──────────────────────────────────────
-- 用户可以对自己的维护状态做全部操作（含 UPDATE，这是与
-- redemption_requests 的关键区别——那张表状态流转由业务方在
-- Supabase Studio 手动改，这张表则由用户自己的维护动作驱动）。

ALTER TABLE wuxing_maintenance_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户只能操作自己的维护状态" ON wuxing_maintenance_state;
CREATE POLICY "用户只能操作自己的维护状态"
    ON wuxing_maintenance_state FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
-- ══════════════════════════════════════════════════════════════
-- 2026-08-18 邀请裂变系统："邀君同游"任务从荣誉制改造为真实追踪
-- 前端（user-system 领域）负责：生成分享链接（?ref=邀请码）、解析邀请码、
-- 注册后写入 referrals 行、首次成功生成岛屿后调用 activate_my_referral()。
-- 本节只负责数据表结构与两个安全函数，业务规则：
--   1) 新用户通过邀请链接注册 → 前端 insert 一行 referrals →
--      触发器自动、仅一次给"被邀请人"发 50 灵气欢迎奖励
--   2) 被邀请人首次成功生成岛屿 → 前端调用 activate_my_referral()（无参数，
--      内部用 auth.uid() 识别调用者）→ 标记该邀请已激活 + 给"邀请人"发奖励
--      （邀请人首次成功邀请150灵气，之后每次80灵气），整个过程原子且天然防重复
-- ══════════════════════════════════════════════════════════════

-- ── profiles 表补列：每个用户的专属邀请码 ──────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- 生成一个当前在 profiles 表里唯一的邀请码（8位大写十六进制）。
-- 循环重试而非依赖 UNIQUE 约束报错重试：避免把一次性偶发冲突变成整个
-- 调用方事务失败。attempts 上限只是防御性熔断，8位空间在本产品体量下
-- 实际几乎不可能连续碰撞。
CREATE OR REPLACE FUNCTION generate_unique_referral_code()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code     TEXT;
  v_attempts INT := 0;
BEGIN
  LOOP
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 8));
    v_attempts := v_attempts + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE referral_code = v_code) OR v_attempts > 20;
  END LOOP;
  RETURN v_code;
END;
$$;

-- 新建 profiles 行时若没带 referral_code（前端注册流程 upsert 不会带这个
-- 字段），自动补一个。注意这是 BEFORE INSERT 触发器：对已存在行的 upsert
-- （命中 ON CONFLICT DO UPDATE 分支）不会重新触发，不会覆盖已有邀请码。
CREATE OR REPLACE FUNCTION set_profile_referral_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := generate_unique_referral_code();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_profile_referral_code ON profiles;
CREATE TRIGGER trg_set_profile_referral_code
    BEFORE INSERT ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_profile_referral_code();

-- 一次性回填：本迁移脚本执行时已存在、但还没有邀请码的老用户（他们的
-- profiles 行早于本次迁移插入，上面的 BEFORE INSERT 触发器不会补发）。
-- 逐行 UPDATE 而不是一条批量 UPDATE：批量 UPDATE 里同一语句内多行各自调用
-- 该函数时，彼此的新值互相不可见（同一语句用同一快照），理论上可能撞码导致
-- UNIQUE 约束报错、整个迁移失败；逐行循环里每次 UPDATE 在同一事务内立即可见，
-- 下一行生成时能查到，天然避免同批次碰撞。可安全重复执行（第二次运行时
-- WHERE referral_code IS NULL 已经没有行匹配）。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM profiles WHERE referral_code IS NULL LOOP
    UPDATE profiles SET referral_code = generate_unique_referral_code() WHERE id = r.id;
  END LOOP;
END $$;

-- 供前端解析"邀请码 → 邀请人 user id"：新用户点击 ?ref=CODE 链接时（可能
-- 尚未登录/尚未完成注册），需要把邀请码换成邀请人的 UUID 才能写入下面的
-- referrals.referrer_id。profiles 表本身的 RLS 只允许用户读自己的行，
-- 匿名/新用户读不到别人的 profiles 行，所以必须有这个 SECURITY DEFINER
-- 函数按需只返回一个 UUID（不泄露昵称/手机号等其它 profiles 字段）。
CREATE OR REPLACE FUNCTION resolve_referral_code(p_code TEXT)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT id FROM profiles WHERE referral_code = p_code LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_referral_code(TEXT) TO anon, authenticated;

-- ── 邀请记录表 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    referrer_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invitee_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    activated_at      TIMESTAMPTZ,
    is_first_referral BOOLEAN DEFAULT FALSE,
    -- 防止自己邀请自己（同一账号把 referrer_id 也填成自己的 id 骗取邀请人
    -- 奖励）：表级 CHECK 约束，即便绕开下面的 RLS 也拦得住
    CONSTRAINT referrals_no_self_referral CHECK (referrer_id <> invitee_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户可查看自己发出的邀请记录" ON referrals;
CREATE POLICY "用户可查看自己发出的邀请记录" ON referrals FOR SELECT USING (auth.uid() = referrer_id);

DROP POLICY IF EXISTS "用户可查看自己被邀请的记录" ON referrals;
CREATE POLICY "用户可查看自己被邀请的记录" ON referrals FOR SELECT USING (auth.uid() = invitee_id);

DROP POLICY IF EXISTS "用户注册时插入自己被邀请的记录" ON referrals;
CREATE POLICY "用户注册时插入自己被邀请的记录" ON referrals
    FOR INSERT WITH CHECK (auth.uid() = invitee_id AND referrer_id <> invitee_id);
-- 故意不给 UPDATE 策略：activated_at 只能通过下面的 SECURITY DEFINER 函数写入，
-- 前端无法直接改（防止有人直接把自己的邀请记录标成"已激活"骗取邀请人奖励——
-- 虽然奖励发到的是 referrer 账号而非攻击者自己，但仍要杜绝任意触发他人加余额）

-- 被邀请人的欢迎奖励：referrals 行插入成功后自动、仅一次触发（invitee_id
-- 有 UNIQUE 约束，同一被邀请人不可能被插入第二行，天然防止重复领取）。
-- 用 INSERT ... ON CONFLICT 而非单纯 UPDATE：本项目开启邮箱验证，
-- js/auth.js 的 signUp() 在真正建立 session 前尝试 upsert profiles 行会被
-- RLS 拒绝（见已知问题记录 2026-08-16 那条时序陷阱），所以被邀请人在确认
-- 邮箱、建立 session 之前，profiles 行大概率还不存在——此时若这里只用
-- UPDATE，WHERE id = NEW.invitee_id 会匹配 0 行、静默"成功"，50灵气凭空
-- 消失且没有任何报错。改成 upsert 后，profiles 行不存在时直接以 50 灵气
-- 插入新行（referral_code 由 trg_set_profile_referral_code 的 BEFORE INSERT
-- 触发器自动补，country/phone_code 等其它列均有默认值或允许为空，不会导致
-- 这条 INSERT 本身失败）；已存在则退回原来的增量写法。
CREATE OR REPLACE FUNCTION grant_referral_welcome_bonus()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, spirit_balance) VALUES (NEW.invitee_id, 50)
  ON CONFLICT (id) DO UPDATE SET spirit_balance = COALESCE(profiles.spirit_balance, 0) + 50;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_referral_welcome_bonus ON referrals;
CREATE TRIGGER trg_referral_welcome_bonus AFTER INSERT ON referrals
    FOR EACH ROW EXECUTE FUNCTION grant_referral_welcome_bonus();

-- 邀请人的激活奖励：被邀请人首次成功生成岛屿时由前端调用（无参数，只认
-- auth.uid()，杜绝伪造成别人身份触发）。用 SELECT ... FOR UPDATE 锁住自己
-- 这一行邀请记录再重新核对 activated_at IS NULL：并发/重复调用时，后到达
-- 的调用会在这里阻塞，等第一次调用提交后重新求值 WHERE 条件已不再满足，
-- 直接查不到行、安全返回，天然防止重复发奖（比"先 SELECT 判断再 UPDATE"
-- 两步式判断更严格，后者存在两步之间的竞态窗口）。另外锁一下邀请人的
-- profiles 行，避免同一邀请人名下两个被邀请人几乎同时首次生成岛屿时，
-- 都在明明只有一个"第一次"的情况下各自判断出"我是第一个"、都拿满 150。
CREATE OR REPLACE FUNCTION activate_my_referral()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referrer_id UUID;
  v_is_first    BOOLEAN;
  v_reward      INTEGER;
BEGIN
  SELECT referrer_id INTO v_referrer_id
    FROM referrals
    WHERE invitee_id = auth.uid() AND activated_at IS NULL
    FOR UPDATE;

  IF v_referrer_id IS NULL THEN
    RETURN; -- 不是通过邀请链接注册的、或这条邀请已经激活过，什么都不做
  END IF;

  PERFORM 1 FROM profiles WHERE id = v_referrer_id FOR UPDATE;

  SELECT NOT EXISTS (
    SELECT 1 FROM referrals WHERE referrer_id = v_referrer_id AND activated_at IS NOT NULL
  ) INTO v_is_first;
  v_reward := CASE WHEN v_is_first THEN 150 ELSE 80 END;

  UPDATE referrals SET activated_at = NOW(), is_first_referral = v_is_first
    WHERE invitee_id = auth.uid() AND activated_at IS NULL;

  UPDATE profiles SET spirit_balance = COALESCE(spirit_balance, 0) + v_reward
    WHERE id = v_referrer_id;
END;
$$;
REVOKE ALL ON FUNCTION activate_my_referral() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_my_referral() TO authenticated;

-- ── 增量式灵气余额同步（通用 RPC，不限于邀请裂变场景）──────────────
-- 背景：js/user-state.js 现有的 syncSpiritBalance() 把客户端本地算好的
-- "绝对值"整包 upsert 覆盖云端 spirit_balance，这套"推绝对值 + 登录时取
-- max 合并"的架构只对"同一份余额被多端各自独立累积、需要合并"这种场景
-- 成立。凡是服务端单方面发放奖励（本节的欢迎奖励触发器 / 邀请激活奖励，
-- 以及未来任何"服务端发钱"场景）都跟它冲突：奖励入账那一刻发生在云端，
-- 客户端完全不知情，之后任何一次本地"绝对值"同步都会把云端余额直接覆盖、
-- 抹掉服务端刚发的钱——取 max 也救不回来（被邀请人本地余额本来就可能比
-- 服务端刚发的新值大，取 max 结果不变，增量还是凭空消失，而不是正确地
-- 相加）。
-- 这个函数提供另一条路：前端每次本地灵气变化需要同步上云时，改为调用
-- adjust_spirit_balance(本次变动量) 而不是推整个绝对值，服务端按增量
-- UPDATE，天然不会覆盖任何期间内服务端自己发放的奖励。
-- GREATEST(0, ...) 只是防御性下限，防止意外的负数 delta（例如客户端消费
-- 类操作算错）把余额打穿到负数以下，不影响正常场景的行为。
-- 未在此处特殊处理 profiles 行不存在导致 UPDATE 匹配 0 行、RETURNING 拿
-- 不到值返回 NULL 的边界情况：这个函数只认 auth.uid()，必须已通过
-- 认证才能调用到这里，而认证成功即意味着该用户已完成注册流程、
-- profiles 行按产品现有逻辑应当已经存在（若确实为 NULL，调用方可按
-- "本次同步失败、维持本地值不变、下次重试"处理，不需要在数据库层再加一次
-- upsert——upsert 需要决定 display_name/country 等字段的默认值，属于业务
-- 语义，交给调用方更合适，这里保持函数职责单一）。
CREATE OR REPLACE FUNCTION adjust_spirit_balance(p_delta INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new INTEGER;
BEGIN
  UPDATE profiles
    SET spirit_balance = GREATEST(0, COALESCE(spirit_balance, 0) + p_delta)
    WHERE id = auth.uid()
    RETURNING spirit_balance INTO v_new;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION adjust_spirit_balance(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_spirit_balance(INTEGER) TO authenticated;
