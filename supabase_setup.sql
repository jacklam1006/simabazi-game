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

-- ═══════════════════════════════════════════════════════════════
-- 2026-08-19 灵气防篡改加固
-- ═══════════════════════════════════════════════════════════════
-- 背景：profiles 表的 RLS 策略"用户只能更新自己的资料"（见上方
-- "用户只能更新自己的资料" 策略，USING/WITH CHECK auth.uid()=id）只限制了
-- "能改哪一行"，没有限制"能改哪些列"——任何登录用户都可以直接对自己那一行
-- 发起 UPDATE/upsert，把 spirit_balance（虚拟货币）改成任意数字，属于安全
-- 漏洞。RLS 是行级过滤，天然不解决列级问题，必须叠加 Postgres 列级权限
-- （REVOKE/GRANT ... (列名)）这套独立机制才能堵上，两者不能互相替代。

-- ── 管理员标记列（供下方 admin_set_spirit_balance 识别调用者权限）───
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 收回 profiles 表级 UPDATE/INSERT 权限，改用列白名单 GRANT 放行 ──
-- 2026-08-19 曾经用过 REVOKE UPDATE (spirit_balance) ON profiles ... 这种
-- "只收紧单列"的写法，本地 Postgres 实测证明这是空操作、漏洞原样存在：
-- Postgres 权限检查顺序是先查表级 ACL，只要表级 UPDATE 已经放行（Supabase
-- 项目默认会给 anon/authenticated 授予表级 ALL 权限），根本不会再去看列级
-- ACL，列级 REVOKE 减不掉表级授权。更麻烦的是这条语句执行时不报错、不报
-- 警告，非常容易让人误以为"已经收紧了"。
--
-- 正确做法必须反过来：先把表级 UPDATE/INSERT 整体收回，再用列白名单把
-- 允许前端直接改的列 GRANT 回去。这样即使表级 ACL 曾经被 Supabase 默认
-- 设成 ALL，也会被下面这条表级 REVOKE 清空，之后能不能改某一列完全由
-- 列级 GRANT 决定，不存在"表级放行、列级形同虚设"的问题。
--
-- 白名单只包含 display_name/country/phone_code/phone 这几个用户可自行
-- 编辑的资料列；刻意不包含 spirit_balance（虚拟货币，只能走下方
-- SECURITY DEFINER 函数改）、is_admin（管理员标记，只能在 Supabase
-- Studio 手动改）、referral_code（由 BEFORE INSERT 触发器生成，见上方
-- generate_unique_referral_code 相关逻辑，不应被前端覆盖）。
-- registerWithProfile()（js/auth.js 约92-98行，payload 为
-- {id, display_name, country, phone_code, phone}）和 updateProfile()
-- （payload 为 {id, display_name}）用的都是 upsert，同时涉及 INSERT 和
-- ON CONFLICT UPDATE 两条路径，因此下面 INSERT/UPDATE 两条白名单 GRANT
-- 都要覆盖这几列，两个函数才能继续正常工作。
--
-- ⚠️ UPDATE 白名单为什么要包含 id（2026-08-19 qa-reviewer用真实本地
-- Postgres+PostgREST v12源码复现发现，务必记住，否则未来任何一次改动这段
-- 白名单都可能重蹈覆辙）：supabase-js 的 .upsert({id, display_name}) 实际
-- 生成的是 INSERT ... ON CONFLICT(id) DO UPDATE SET id = EXCLUDED.id,
-- display_name = EXCLUDED.display_name —— PostgREST 的 mutatePlanToQuery
-- （MergeDuplicates 分支）对 payload 里出现的全部列生成 SET 列表，包括
-- 冲突键 id 本身，不会自动排除冲突列。如果 UPDATE 白名单不包含 id，这条
-- SET id = EXCLUDED.id 语句本身就会因为列级权限不够而报错，导致
-- registerWithProfile()/updateProfile() 的 upsert 100%必现
-- "permission denied for table profiles"（这正是本条注释最初版本漏掉的
-- 场景——当时手写的模拟SQL只写了 SET display_name=...，没有照抄真实
-- PostgREST 生成的 SET id=EXCLUDED.id, display_name=...，测出了不符合真实
-- 情况的假阳性"成功"）。
-- 这不会开新的安全洞：上方"用户只能更新自己的资料"策略只写了
-- USING (auth.uid() = id)，没有单独写 WITH CHECK——Postgres 对只写 USING
-- 的 UPDATE 策略，会让这个表达式同时充当新行的隐式 CHECK 条件。所以哪怕
-- 授予了 UPDATE(id)，任何尝试把自己的 id 改成别人 uuid 的操作，都会被
-- "新行不满足 auth.uid()=id" 这条隐式 CHECK 拦下，报"新行违背了表的行级
-- 安全策略"，而不是真的能改成功。正常 upsert 场景里 id = EXCLUDED.id 是
-- "自己赋值给自己"（冲突键本来就是同一个 id），这条 GRANT 只是让这句
-- 自反赋值本身能通过列级权限检查，不会让任何人真正改写 id 的值。
REVOKE UPDATE, INSERT ON profiles FROM authenticated, anon;
GRANT UPDATE (id, display_name, country, phone_code, phone) ON profiles TO authenticated;
GRANT INSERT (id, display_name, country, phone_code, phone) ON profiles TO authenticated;

-- ── 登录合并专用：本地余额 > 云端余额 时取较大值写回 ─────────────
-- 替代原来 js/auth.js syncSpiritBalance() 里"本地值整包 upsert 覆盖云端"
-- 的绝对值写法（该写法在表级权限收回后已无法直接执行）。取
-- GREATEST(云端, 本地) 天然幂等、不会把余额往回调小，也不会抹掉调用
-- 之前云端可能已经入账的服务端奖励（欢迎奖励/邀请奖励等，均只增不减，
-- 取 max 不受影响）。
--
-- 用 INSERT ... ON CONFLICT 而不是纯 UPDATE：本项目开启了邮箱验证，
-- registerWithProfile() 的首次 upsert 在真正建立 session 之前会被 RLS
-- 拒绝，导致新注册用户的 profiles 行大概率还不存在。纯 UPDATE 在这种
-- 情况下会匹配 0 行、RETURNING 拿不到值，函数返回 NULL，而 js/auth.js
-- 只检查了 error 没检查这种"成功但返回 NULL"的情况，会静默吞掉——这正是
-- grant_referral_welcome_bonus() 已经踩过并改成 upsert 写法的同一个坑
-- （见上方该函数的写法与注释）。改成 INSERT ... ON CONFLICT 后行不存在
-- 时会先创建再返回正确值，行已存在时走 DO UPDATE 分支正确取较大值。
CREATE OR REPLACE FUNCTION reconcile_spirit_balance_up(p_local_value INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new INTEGER;
BEGIN
  INSERT INTO profiles (id, spirit_balance)
    VALUES (auth.uid(), GREATEST(0, COALESCE(p_local_value, 0)))
  ON CONFLICT (id) DO UPDATE
    SET spirit_balance = GREATEST(COALESCE(profiles.spirit_balance, 0), COALESCE(p_local_value, 0))
  RETURNING spirit_balance INTO v_new;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION reconcile_spirit_balance_up(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_spirit_balance_up(INTEGER) TO authenticated;

-- ── 管理员测试专用：任意设定灵气值（自己或指定用户）──────────────
-- GRANT EXECUTE 面向所有 authenticated 角色（跟其它 RPC 一致），安全性
-- 完全靠函数体内部的 is_admin 检查兜底：非管理员调用直接 RAISE EXCEPTION
-- 报错、不产生任何副作用。这是刻意的设计，不是权限授予过宽的疏漏。
-- p_target_id 缺省（NULL）时默认操作调用者自己，方便管理员本人测试；
-- 传入其它用户 UUID 则可以给测试账号直接充值/清零，无需伪造登录态。
-- is_admin 列的具体赋值（谁是管理员）需要在 Supabase Studio 手动执行
-- UPDATE，不通过任何前端或此 SQL 文件完成。
CREATE OR REPLACE FUNCTION admin_set_spirit_balance(p_value INTEGER, p_target_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target UUID := COALESCE(p_target_id, auth.uid());
  v_new    INTEGER;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), FALSE) THEN
    RAISE EXCEPTION '权限不足：仅管理员可调用';
  END IF;
  UPDATE profiles SET spirit_balance = GREATEST(0, p_value) WHERE id = v_target
    RETURNING spirit_balance INTO v_new;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION admin_set_spirit_balance(INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_spirit_balance(INTEGER, UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2026-08-19 灵气值服务端权威记账重构
-- ═══════════════════════════════════════════════════════════════
-- 背景：上一节"灵气防篡改加固"堵住了"直接改 profiles.spirit_balance 列"
-- 这一条路，但 adjust_spirit_balance(p_delta)/reconcile_spirit_balance_up
-- (p_local_value) 这两个通用同步 RPC 仍然完全信任客户端传入的数值/增量——
-- 任何登录用户都可以直接调用把灵气刷到任意数字，只是换了个入口而已，
-- 没有真正解决问题。本节把 4 类发放来源（签到/任务/五行免费维护/裂变邀请，
-- 其中裂变邀请此前已是服务端权威、不在本次改造范围）与 3 类消费场景
-- （五行瞬间调理/水晶兑换/请神仙巩固）全部改成由服务端按真实业务事件独立
-- 计算金额、原子写库，前端只读结果，不再传任何"你欠我多少钱"式的数值。
-- 前端调用点改造（js/user-state.js、js/tasks.js、js/wuxing-maintenance.js、
-- js/products.js、js/auth.js）由并行的 user-system 任务负责，不在本节
-- diff 范围内；本节只负责与之对接的数据库结构与 RPC，函数名/参数/返回值
-- 是双方约定好的接口契约，不能单方面改动。

-- ── profiles 表补列：签到状态 ────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_checkin_date DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS checkin_streak SMALLINT NOT NULL DEFAULT 0;

-- ── 任务完成记录表 ──────────────────────────────────────────────
-- 每完成一次任务领奖就落一行，靠下面的唯一索引防止同一任务被重复领取。
CREATE TABLE IF NOT EXISTS task_completions (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id      TEXT NOT NULL,
    day_key      TEXT,  -- 'YYYY-MM-DD'（UTC）用于daily类型去重；onetime类型固定NULL
    completed_at TIMESTAMPTZ DEFAULT NOW()
);
-- COALESCE技巧：NULL在唯一索引里互不相等，onetime任务day_key恒为NULL时
-- 必须转成空字符串参与比较，否则同一用户同一个onetime任务能重复插入多行、
-- 重复领取奖励。
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_completions_unique
    ON task_completions(user_id, task_id, COALESCE(day_key, ''));
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "用户只能读取自己的任务完成记录" ON task_completions;
CREATE POLICY "用户只能读取自己的任务完成记录" ON task_completions FOR SELECT USING (auth.uid() = user_id);
-- 不给INSERT/UPDATE/DELETE策略：这张表只由下面的SECURITY DEFINER函数写入，
-- 前端不应该、也不需要直接操作它。

-- ── 每日签到：逐字复刻 js/user-state.js::doCheckin() 的业务规则 ──────
-- 用 INSERT ... ON CONFLICT 而不是纯 UPDATE：与本文件反复强调的同一个坑
-- 一致——若 profiles 行不存在，纯 UPDATE 会匹配 0 行、RETURNING 拿不到
-- 值，20/30灵气奖励凭空消失且不报错。
CREATE OR REPLACE FUNCTION claim_daily_checkin()
RETURNS TABLE(already_done BOOLEAN, streak INTEGER, bonus INTEGER, new_balance INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last_date  DATE;
  v_streak     INTEGER;
  v_new_streak INTEGER;
  v_bonus      INTEGER;
  v_balance    INTEGER;
BEGIN
  SELECT last_checkin_date, checkin_streak INTO v_last_date, v_streak
    FROM profiles WHERE id = auth.uid() FOR UPDATE;

  IF v_last_date = CURRENT_DATE THEN
    SELECT spirit_balance INTO v_balance FROM profiles WHERE id = auth.uid();
    RETURN QUERY SELECT TRUE, COALESCE(v_streak, 0), 0, COALESCE(v_balance, 0);
    RETURN;
  END IF;

  v_new_streak := CASE WHEN v_last_date = CURRENT_DATE - 1 THEN COALESCE(v_streak, 0) + 1 ELSE 1 END;
  v_bonus := CASE WHEN v_new_streak >= 7 THEN 30 WHEN v_new_streak >= 3 THEN 20 ELSE 10 END;

  INSERT INTO profiles (id, last_checkin_date, checkin_streak, spirit_balance)
    VALUES (auth.uid(), CURRENT_DATE, v_new_streak, v_bonus)
  ON CONFLICT (id) DO UPDATE SET
    last_checkin_date = CURRENT_DATE,
    checkin_streak     = v_new_streak,
    spirit_balance      = COALESCE(profiles.spirit_balance, 0) + v_bonus
  RETURNING spirit_balance INTO v_balance;

  RETURN QUERY SELECT FALSE, v_new_streak, v_bonus, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION claim_daily_checkin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_daily_checkin() TO authenticated;

-- ── 任务领奖：与 js/tasks.js TASK_DEFS 保持同步，改任务奖励金额时两边都要改 ──
-- invite_friend 任务不收录在这张任务表里：它的奖励已经完全由
-- activate_my_referral() 单独发放，走这个函数会造成重复发奖。
CREATE OR REPLACE FUNCTION claim_task(p_task_id TEXT)
RETURNS TABLE(spirit_awarded INTEGER, new_balance INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type    TEXT;
  v_spirit  INTEGER;
  v_day_key TEXT;
  v_need    INTEGER;
  v_balance INTEGER;
BEGIN
  SELECT type, spirit INTO v_type, v_spirit FROM (VALUES
    ('daily_checkin','daily',10), ('daily_read_analysis','daily',15), ('daily_share','daily',20),
    ('first_island','onetime',50), ('streak_3','onetime',30), ('streak_7','onetime',80),
    ('streak_30','onetime',300), ('read_dayun','onetime',25), ('read_shensha','onetime',25)
  ) AS t(task_id, type, spirit) WHERE t.task_id = p_task_id;

  IF v_type IS NULL THEN
    RAISE EXCEPTION '未知任务: %', p_task_id;
  END IF;

  IF p_task_id = 'first_island' AND NOT EXISTS (SELECT 1 FROM islands WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION '尚未满足任务条件: %', p_task_id;
  END IF;

  IF p_task_id IN ('streak_3', 'streak_7', 'streak_30') THEN
    v_need := CASE p_task_id WHEN 'streak_3' THEN 3 WHEN 'streak_7' THEN 7 ELSE 30 END;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND checkin_streak >= v_need) THEN
      RAISE EXCEPTION '尚未满足任务条件: %', p_task_id;
    END IF;
  END IF;

  v_day_key := CASE WHEN v_type = 'daily' THEN to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD') ELSE NULL END;

  BEGIN
    INSERT INTO task_completions (user_id, task_id, day_key) VALUES (auth.uid(), p_task_id, v_day_key);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '任务已领取过: %', p_task_id;
  END;

  INSERT INTO profiles (id, spirit_balance) VALUES (auth.uid(), v_spirit)
  ON CONFLICT (id) DO UPDATE SET spirit_balance = COALESCE(profiles.spirit_balance, 0) + v_spirit
  RETURNING spirit_balance INTO v_balance;

  RETURN QUERY SELECT v_spirit, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION claim_task(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_task(TEXT) TO authenticated;

-- ── 五行免费维护：tier 接受客户端上报但 clamp 到 1-3，severity 只信任 ──
-- 服务端已存储的 wuxing_maintenance_state.base_tier（base_tier=3 等价于
-- 原来客户端算的 severity===2）。tier 的完整计算是一套带浮点时间窗口的
-- 复杂懒计算算法（js/wuxing-maintenance.js::_computeTier()，已用
-- 200000+组fuzz测试验证），在此重新用SQL实现一遍风险极高、还会制造
-- "同一算法两处实现"的耦合（历史上哈希算法双实现吃过两次亏，见文件顶部
-- 教训）。收紧到"tier一个自由变量、且clamp在1-3"后，最坏情况每次调用
-- 最多虚报到tier=3算出19，比老实汇报tier=1的8多11点，且下面"每日一次"
-- 限制原样保留，不是无限刷。
--
-- 2026-08-21 修复C2（严重，死锁）：本函数原先要求 wuxing_maintenance_state
-- 里预先存在对应行，但该行只在这个函数（以及 wuxing_instant_fix）成功
-- 之后才由前端 syncWuxingMaintenanceState() 写入云端——鸡生蛋死锁，全新
-- 登录用户第一次维护任何一条五行问题必定失败，永远无法自愈（本地Postgres
-- 已实测复现：对从未同步过的组合调用直接报"未找到对应的维护状态记录"）。
-- 改为"行不存在就先创建"：新增 p_base_tier 参数，但只在创建新行时使用
-- （clamp到1-3）；如果行已存在，完全忽略这次传入的 p_base_tier、继续用
-- 已存的 base_tier，不允许覆盖——否则客户端每次调用都能用一个新的
-- base_tier 覆盖服务端已经"钉死"的严重度评级，等于把 base_tier 也变成了
-- 客户端自由变量。
-- 函数参数列表从 (TEXT,TEXT,TEXT,SMALLINT) 变为 (TEXT,TEXT,TEXT,SMALLINT,
-- SMALLINT)，这在Postgres里是一个新的重载签名而不是对旧签名的替换——
-- CREATE OR REPLACE 只匹配"名称+参数类型列表完全相同"的函数，参数列表变了
-- 就会两个签名同时存在。必须先显式 DROP 旧的4参数版本，否则前端 rpc()
-- 调用会因为存在两个同名重载而产生歧义。
DROP FUNCTION IF EXISTS wuxing_free_maintain(TEXT, TEXT, TEXT, SMALLINT);
CREATE OR REPLACE FUNCTION wuxing_free_maintain(p_bazi_key TEXT, p_wx TEXT, p_direction TEXT, p_tier SMALLINT, p_base_tier SMALLINT DEFAULT 1)
RETURNS TABLE(spirit_awarded INTEGER, new_balance INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row     wuxing_maintenance_state%ROWTYPE;
  v_tier    SMALLINT := GREATEST(1, LEAST(3, COALESCE(p_tier, 1)));
  v_award   INTEGER;
  v_balance INTEGER;
BEGIN
  INSERT INTO wuxing_maintenance_state (user_id, bazi_key, wx, direction, base_tier)
    VALUES (auth.uid(), p_bazi_key, p_wx, p_direction, GREATEST(1, LEAST(3, COALESCE(p_base_tier, 1))))
  ON CONFLICT (user_id, bazi_key, wx, direction) DO NOTHING;

  SELECT * INTO v_row FROM wuxing_maintenance_state
    WHERE user_id = auth.uid() AND bazi_key = p_bazi_key AND wx = p_wx AND direction = p_direction
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到对应的维护状态记录'; END IF;
  IF v_row.ownership_tier = 'shrine' THEN RAISE EXCEPTION '该问题已永久巩固，无需维护'; END IF;
  IF v_row.last_free_maintain_date = (now() AT TIME ZONE 'utc')::date THEN
    RAISE EXCEPTION '今日已经维护过';
  END IF;

  v_award := 8 + 4 * (v_tier - 1) + (CASE WHEN v_row.base_tier = 3 THEN 3 ELSE 0 END);

  UPDATE wuxing_maintenance_state SET
    last_maintained_at      = NOW(),
    first_cycle_consumed    = TRUE,
    last_free_maintain_date = (now() AT TIME ZONE 'utc')::date,
    updated_at               = NOW()
  WHERE id = v_row.id;

  INSERT INTO profiles (id, spirit_balance) VALUES (auth.uid(), v_award)
  ON CONFLICT (id) DO UPDATE SET spirit_balance = COALESCE(profiles.spirit_balance, 0) + v_award
  RETURNING spirit_balance INTO v_balance;

  RETURN QUERY SELECT v_award, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION wuxing_free_maintain(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wuxing_free_maintain(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;

-- ── 五行瞬间调理：花钱不赚钱，同一函数里原子完成"扣费+更新维护状态" ──
-- 不拆成先调 spend_spirit() 再调这个：否则中间态可能钱扣了但维护状态
-- 没更新。tier 的取舍理由同上方 wuxing_free_maintain()。
-- 2026-08-21 修复C2：同上方 wuxing_free_maintain() 一样的鸡生蛋死锁——
-- "行不存在就先创建，p_base_tier 仅创建时使用"，同样先 DROP 旧4参数签名
-- 避免重载歧义。
DROP FUNCTION IF EXISTS wuxing_instant_fix(TEXT, TEXT, TEXT, SMALLINT);
CREATE OR REPLACE FUNCTION wuxing_instant_fix(p_bazi_key TEXT, p_wx TEXT, p_direction TEXT, p_tier SMALLINT, p_base_tier SMALLINT DEFAULT 1)
RETURNS TABLE(spirit_cost INTEGER, new_balance INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row     wuxing_maintenance_state%ROWTYPE;
  v_tier    SMALLINT := GREATEST(1, LEAST(3, COALESCE(p_tier, 1)));
  v_cost    INTEGER;
  v_balance INTEGER;
BEGIN
  INSERT INTO wuxing_maintenance_state (user_id, bazi_key, wx, direction, base_tier)
    VALUES (auth.uid(), p_bazi_key, p_wx, p_direction, GREATEST(1, LEAST(3, COALESCE(p_base_tier, 1))))
  ON CONFLICT (user_id, bazi_key, wx, direction) DO NOTHING;

  SELECT * INTO v_row FROM wuxing_maintenance_state
    WHERE user_id = auth.uid() AND bazi_key = p_bazi_key AND wx = p_wx AND direction = p_direction
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到对应的维护状态记录'; END IF;
  IF v_row.ownership_tier = 'shrine' THEN RAISE EXCEPTION '该问题已永久巩固，无需调理'; END IF;

  v_cost := 15 + 15 * (v_tier - 1) + (CASE WHEN v_row.base_tier = 3 THEN 10 ELSE 0 END);

  UPDATE profiles SET spirit_balance = spirit_balance - v_cost
    WHERE id = auth.uid() AND spirit_balance >= v_cost
    RETURNING spirit_balance INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '灵气不足'; END IF;

  UPDATE wuxing_maintenance_state SET
    last_maintained_at   = NOW(), first_cycle_consumed = TRUE, updated_at = NOW()
  WHERE id = v_row.id;

  RETURN QUERY SELECT v_cost, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION wuxing_instant_fix(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wuxing_instant_fix(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;

-- ── 通用原子扣费：供 js/products.js 兑换水晶/请神仙商品用 ─────────────
-- 商品价格是固定商品目录，不需要专属RPC，直接传目录里写死的价格扣费即可。
CREATE OR REPLACE FUNCTION spend_spirit(p_amount INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION '无效的扣费金额'; END IF;
  UPDATE profiles SET spirit_balance = spirit_balance - p_amount
    WHERE id = auth.uid() AND spirit_balance >= p_amount
    RETURNING spirit_balance INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '灵气不足'; END IF;
  RETURN v_balance;
END;
$$;
REVOKE ALL ON FUNCTION spend_spirit(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spend_spirit(INTEGER) TO authenticated;

-- ── 五行问题所有权标记：供商品兑换成功（spend_spirit 已扣款）后调用 ──
-- 把五行问题标记为"水晶态"或"请神仙态"。必须 INSERT ... ON CONFLICT：
-- 该五行问题的 wuxing_maintenance_state 行不一定已经同步到云端过。
CREATE OR REPLACE FUNCTION set_wuxing_ownership(
  p_bazi_key TEXT, p_wx TEXT, p_direction TEXT,
  p_base_tier SMALLINT, p_ownership_tier TEXT, p_product_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ownership_tier NOT IN ('crystal', 'shrine') THEN
    RAISE EXCEPTION '无效的ownership_tier: %', p_ownership_tier;
  END IF;
  INSERT INTO wuxing_maintenance_state (user_id, bazi_key, wx, direction, base_tier, ownership_tier, ownership_product_id, last_maintained_at, first_cycle_consumed)
    VALUES (auth.uid(), p_bazi_key, p_wx, p_direction, GREATEST(1, LEAST(3, COALESCE(p_base_tier, 1))), p_ownership_tier, p_product_id, NOW(), TRUE)
  ON CONFLICT (user_id, bazi_key, wx, direction) DO UPDATE SET
    ownership_tier        = EXCLUDED.ownership_tier,
    ownership_product_id  = EXCLUDED.ownership_product_id,
    last_maintained_at     = NOW(),
    first_cycle_consumed   = TRUE,
    updated_at              = NOW();
END;
$$;
REVOKE ALL ON FUNCTION set_wuxing_ownership(TEXT, TEXT, TEXT, SMALLINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_wuxing_ownership(TEXT, TEXT, TEXT, SMALLINT, TEXT, TEXT) TO authenticated;

-- ── 锁死旧的"客户端传任意数值"RPC ────────────────────────────────
-- 灵气值已全面改为按真实业务事件由服务端权威计算，不再接受客户端直接
-- 传入数值/增量——这两个函数不再被任何合法前端流程调用，收回执行权限
-- （不删除函数体，保留审计痕迹）。
REVOKE EXECUTE ON FUNCTION adjust_spirit_balance(INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION reconcile_spirit_balance_up(INTEGER) FROM authenticated;

-- ── 顺带发现并修复的相关漏洞：wuxing_maintenance_state 可被绕过购买 ──
-- 该表的RLS策略是 FOR ALL USING/WITH CHECK(auth.uid()=user_id)，只限制了
-- "能改哪一行"，配合Supabase默认表级授权（authenticated对该表默认拥有
-- 表级ALL权限），用户可以直接UPDATE自己那一行的ownership_tier列——意味着
-- 不花灵气、直接把某条五行问题的ownership_tier改成'shrine'，就能白嫖本该
-- 花800-1200灵气才能买到的"永久巩固"效果。
--
-- 本地Postgres已实测验证：单独对 ownership_tier/ownership_product_id 两列
-- 做 REVOKE UPDATE (...) ... FROM authenticated 是空操作——Postgres权限
-- 检查顺序是先查表级ACL，只要表级UPDATE已经放行（Supabase默认会给
-- authenticated授予表级ALL），根本不会再去看列级ACL，列级REVOKE减不掉
-- 表级授权，且执行时不报错不报警告，极易误以为"已经收紧了"（跟
-- profiles.spirit_balance那次教训完全一样）。因此这里同样改用"先整体收回
-- 表级UPDATE/INSERT、再用列白名单GRANT放行"的模式。
--
-- 白名单只包含 user_id/bazi_key/wx/direction/base_tier/last_maintained_at/
-- first_cycle_consumed/last_free_maintain_date/updated_at 这几列，均不涉及
-- 直接铸造货币/购买效果，继续保留客户端直接写入权限（js/wuxing-maintenance.js
-- ::_syncToCloud() 的多设备merge逻辑依赖这条路径，不在本轮改造范围内）；
-- 刻意排除 ownership_tier/ownership_product_id，此后只能通过上面的
-- set_wuxing_ownership() SECURITY DEFINER函数改（该函数以函数owner身份
-- 执行，不受这里的表级/列级REVOKE影响，见函数注释）。
--
-- 额外把 id 也纳入白名单：这条表的前端upsert（js/auth.js::
-- syncWuxingMaintenanceState()）用 onConflict: 'user_id,bazi_key,wx,direction'
-- 而不是主键id，当前payload也不含id，本次改造严格来说不需要id列权限；
-- 但2026-08-19 qa-reviewer已用PostgREST真实源码证明过"upsert对payload里
-- 出现的全部列生成SET列表，包括冲突键本身"这条通用规律（profiles表那次
-- 就是因为onConflict目标恰好是主键id才踩中），为避免未来任何一次改动
-- 前端payload字段（比如误加了id）时重蹈"permission denied for table"的
-- 覆辙，这里防御性地一并放行id列，不产生新的安全洞（id是随机UUID主键，
-- 不参与任何鉴权判断，且上方RLS策略的隐式WITH CHECK仍然只放行
-- auth.uid()=user_id的行）。
REVOKE UPDATE, INSERT ON wuxing_maintenance_state FROM authenticated, anon;
GRANT INSERT (id, user_id, bazi_key, wx, direction, base_tier, last_maintained_at, first_cycle_consumed, last_free_maintain_date, updated_at)
  ON wuxing_maintenance_state TO authenticated;
GRANT UPDATE (id, user_id, bazi_key, wx, direction, base_tier, last_maintained_at, first_cycle_consumed, last_free_maintain_date, updated_at)
  ON wuxing_maintenance_state TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2026-08-21 修复C3：每日一次上限可被客户端绕过，"每日限一次"形同虚设
-- ═══════════════════════════════════════════════════════════════
-- 背景：上面这段的 UPDATE 白名单把 last_free_maintain_date（wuxing_free_
-- maintain() 用来判断"今天是否已经领过"的标记）和 base_tier（决定奖励/
-- 扣费金额的严重度评级）都留在客户端可直接UPDATE的范围内，加上表级DELETE
-- 权限也从未收回。本地Postgres已实测验证攻击路径：客户端直接
-- UPDATE wuxing_maintenance_state SET last_free_maintain_date = NULL
-- 把"今天维护过"的标记抹掉，再重复调用 wuxing_free_maintain()，可以在
-- 一天内无限次刷灵气；或者直接 DELETE 掉整行，让 wuxing_free_maintain()
-- 的"行不存在就创建"分支（见上方C2修复）重新建一条 last_free_maintain_
-- date=NULL 的全新记录，效果等价，同样绕过每日限额。
--
-- 修复：把 last_free_maintain_date 和 base_tier 从 UPDATE 白名单里去掉，
-- 之后这两列只能分别由 wuxing_free_maintain()（写 last_free_maintain_
-- date）和 C2 新增的建行逻辑/下方 redeem_wuxing_product()（写 base_tier，
-- 仅创建新行时）这些 SECURITY DEFINER 函数写入——这些函数以函数owner身份
-- 执行，不受这里的表级/列级REVOKE影响。last_maintained_at/
-- first_cycle_consumed 不受影响，继续放行客户端直接写：这两列只影响
-- 衰减节奏展示，不直接铸造货币，且 js/wuxing-maintenance.js::_syncToCloud()
-- 的多设备merge逻辑依赖这条路径。
-- 同样用"表级REVOKE UPDATE全部、再按新白名单重新GRANT剩下的列"模式（而
-- 不是对这两列单独REVOKE）——本文件前面profiles/ownership_tier两次都已
-- 验证过，表级已有ALL授权时单独列级REVOKE是空操作，必须表级REVOKE UPDATE
-- 全部再重新GRANT白名单。
REVOKE UPDATE ON wuxing_maintenance_state FROM authenticated, anon;
GRANT UPDATE (id, user_id, bazi_key, wx, direction, last_maintained_at, first_cycle_consumed, updated_at)
  ON wuxing_maintenance_state TO authenticated;

-- 顺带堵上DELETE这个复位手段：删掉行再让RPC重新建一条全新的、
-- last_free_maintain_date=NULL 的记录，等价于绕过每日限额。这张表不需要
-- 客户端DELETE权限（没有任何合法场景需要删除一条五行维护记录）。
REVOKE DELETE ON wuxing_maintenance_state FROM authenticated, anon;

-- ═══════════════════════════════════════════════════════════════
-- 2026-08-21 修复C4：set_wuxing_ownership() 完全不检查/不扣款，"堵住
-- shrine白嫖"这件事实际没做到，只是换了个调用方式
-- ═══════════════════════════════════════════════════════════════
-- 背景：set_wuxing_ownership() 被设计成"前端先调 spend_spirit() 扣钱，
-- 再调这个函数改状态"两步走，但没有任何机制强制这两步必须一起发生——
-- 本地Postgres已实测验证：spirit_balance=0 的账号可以跳过第一步、直接
-- 调用 set_wuxing_ownership(...) 成功拿到 shrine 态，完全没扣钱。
--
-- 修复：废弃这个分步设计，改成一个原子的商品兑换 RPC——价格从服务端自己
-- 维护的商品表（下面 VALUES 列表）里读取，不信任客户端传入的价格；扣款
-- 与状态写入在同一个函数调用（同一个隐式事务）内完成，任何一步失败都会
-- 让整个调用回滚，不存在"钱扣了但状态没改"或"状态改了但没扣钱"的中间态。
--
-- 商品目录须与 js/products.js::PRODUCT_DEFS 保持同步——改商品价格/新增
-- 商品时两边都要改，这是本函数与前端之间新的契约点（此前 spiritCost 只
-- 活在前端一处，现在数据库这份是唯一被实际信任、用来扣款的权威价格表，
-- 前端那份仅用于兑换前的UI展示预估）。
--
-- wx→trait_index 的映射复刻 js/products.js::_wxToIndex()（WX_ORDER =
-- ['木','火','土','金','水']，与 js/bazi-engine.js 全文件一致的顺序），
-- 保持跟前端同一份映射逻辑，不新造一套。
--
-- redemption_requests.contact_phone 拼接方式复刻 js/auth.js::
-- createRedemptionRequest()：((phone_code||'') + (phone||'')).trim() ||
-- null——空字符串一律存NULL，不存''。
CREATE OR REPLACE FUNCTION redeem_wuxing_product(
  p_product_id TEXT, p_bazi_key TEXT, p_wx TEXT, p_direction TEXT, p_base_tier SMALLINT,
  p_island_id UUID, p_trait_summary TEXT
) RETURNS TABLE(new_balance INTEGER, redemption_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cost          INTEGER;
  v_kind          TEXT;
  v_name          TEXT;
  v_wx_index      INTEGER;
  v_balance       INTEGER;
  v_redemption_id UUID;
  v_phone         TEXT;
  v_phone_code    TEXT;
  v_contact_phone TEXT;
BEGIN
  IF p_direction NOT IN ('nourish', 'restrain') THEN
    RAISE EXCEPTION '无效的direction: %', p_direction;
  END IF;

  -- 与 js/products.js PRODUCT_DEFS 保持同步，改商品价格/新增商品时两边都要改
  SELECT cost, kind, name INTO v_cost, v_kind, v_name FROM (VALUES
    ('bracelet_rose',     'crystal', 200,  '粉水晶手链'),
    ('bracelet_obsidian', 'crystal', 250,  '黑曜石手链'),
    ('pillar_amethyst',   'crystal', 350,  '紫水晶柱'),
    ('basin_clear',       'crystal', 500,  '白水晶盆'),
    ('shrine_generic',    'shrine',  1000, '请神仙镇宅')
  ) AS t(product_id, kind, cost, name) WHERE t.product_id = p_product_id;

  IF v_cost IS NULL THEN RAISE EXCEPTION '未知商品: %', p_product_id; END IF;

  -- 复刻 js/products.js::WX_ORDER/_wxToIndex()，仅 crystal 路径需要（写入
  -- redemption_requests.trait_index 这个INTEGER列）；shrine路径不写这张表，
  -- 不需要这个映射合法，宽松放行任意wx。
  v_wx_index := CASE p_wx
    WHEN '木' THEN 0 WHEN '火' THEN 1 WHEN '土' THEN 2 WHEN '金' THEN 3 WHEN '水' THEN 4
    ELSE NULL
  END;
  IF v_kind = 'crystal' AND v_wx_index IS NULL THEN
    RAISE EXCEPTION '无效的wx: %', p_wx;
  END IF;

  UPDATE profiles SET spirit_balance = spirit_balance - v_cost
    WHERE id = auth.uid() AND spirit_balance >= v_cost
    RETURNING spirit_balance INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '灵气不足'; END IF;

  INSERT INTO wuxing_maintenance_state (user_id, bazi_key, wx, direction, base_tier, ownership_tier, ownership_product_id, last_maintained_at, first_cycle_consumed)
    VALUES (auth.uid(), p_bazi_key, p_wx, p_direction, GREATEST(1, LEAST(3, COALESCE(p_base_tier, 1))), v_kind, p_product_id, NOW(), TRUE)
  ON CONFLICT (user_id, bazi_key, wx, direction) DO UPDATE SET
    ownership_tier        = EXCLUDED.ownership_tier,
    ownership_product_id  = EXCLUDED.ownership_product_id,
    last_maintained_at     = NOW(),
    first_cycle_consumed   = TRUE,
    updated_at              = NOW();

  IF v_kind = 'crystal' THEN
    SELECT phone, phone_code INTO v_phone, v_phone_code FROM profiles WHERE id = auth.uid();
    v_contact_phone := NULLIF(TRIM(COALESCE(v_phone_code, '') || COALESCE(v_phone, '')), '');

    INSERT INTO redemption_requests (user_id, product_id, product_name, spirit_cost, island_id, trait_kind, trait_index, trait_summary, contact_phone)
      VALUES (auth.uid(), p_product_id, v_name, v_cost, p_island_id, p_direction, v_wx_index, p_trait_summary, v_contact_phone)
      RETURNING id INTO v_redemption_id;
  END IF;

  RETURN QUERY SELECT v_balance, v_redemption_id;
END;
$$;
REVOKE ALL ON FUNCTION redeem_wuxing_product(TEXT, TEXT, TEXT, TEXT, SMALLINT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_wuxing_product(TEXT, TEXT, TEXT, TEXT, SMALLINT, UUID, TEXT) TO authenticated;

-- set_wuxing_ownership() 不再被任何合法前端流程调用（redeem_wuxing_product
-- 已经把它的职责原子化合并进来），收回执行权限，保留函数体做审计痕迹
-- （不删除，与本文件其它"锁死旧RPC"的一贯做法一致）。
REVOKE EXECUTE ON FUNCTION set_wuxing_ownership(TEXT, TEXT, TEXT, SMALLINT, TEXT, TEXT) FROM authenticated;

-- ── 顺带修复：claim_daily_checkin() 统一改用显式UTC日期 ──────────────
-- 原实现用裸 CURRENT_DATE（取决于数据库会话时区），本文件其它同类RPC
-- （wuxing_free_maintain 的 last_free_maintain_date 判断、claim_task 的
-- day_key）都统一用 (now() AT TIME ZONE 'utc')::date 显式UTC，这里补齐，
-- 避免同一产品内"今天"的判定标准不一致的潜在隐患（例如会话时区被
-- Supabase一侧配置调整后，签到"今天"和五行维护"今天"各自认定的日期
-- 边界不再对齐）。
CREATE OR REPLACE FUNCTION claim_daily_checkin()
RETURNS TABLE(already_done BOOLEAN, streak INTEGER, bonus INTEGER, new_balance INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last_date  DATE;
  v_streak     INTEGER;
  v_new_streak INTEGER;
  v_bonus      INTEGER;
  v_balance    INTEGER;
  v_today      DATE := (now() AT TIME ZONE 'utc')::date;
BEGIN
  SELECT last_checkin_date, checkin_streak INTO v_last_date, v_streak
    FROM profiles WHERE id = auth.uid() FOR UPDATE;

  IF v_last_date = v_today THEN
    SELECT spirit_balance INTO v_balance FROM profiles WHERE id = auth.uid();
    RETURN QUERY SELECT TRUE, COALESCE(v_streak, 0), 0, COALESCE(v_balance, 0);
    RETURN;
  END IF;

  v_new_streak := CASE WHEN v_last_date = v_today - 1 THEN COALESCE(v_streak, 0) + 1 ELSE 1 END;
  v_bonus := CASE WHEN v_new_streak >= 7 THEN 30 WHEN v_new_streak >= 3 THEN 20 ELSE 10 END;

  INSERT INTO profiles (id, last_checkin_date, checkin_streak, spirit_balance)
    VALUES (auth.uid(), v_today, v_new_streak, v_bonus)
  ON CONFLICT (id) DO UPDATE SET
    last_checkin_date = v_today,
    checkin_streak     = v_new_streak,
    spirit_balance      = COALESCE(profiles.spirit_balance, 0) + v_bonus
  RETURNING spirit_balance INTO v_balance;

  RETURN QUERY SELECT FALSE, v_new_streak, v_bonus, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION claim_daily_checkin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_daily_checkin() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2026-08-22 C5-1（严重，可无限刷分）：wuxing_free_maintain() 的"每日一次"
-- 限额可被绕过——真正堵上，不是本文件此前声称的"不是无限刷"
-- ═══════════════════════════════════════════════════════════════
-- 背景（qa-reviewer 第五轮用真实 Postgres 复现）：限额判定粒度是
-- (user_id, bazi_key, wx, direction) 这一整行，而 p_bazi_key/p_wx 是客户端
-- 自由传入的裸文本、服务端完全不校验（wx 列上连 CHECK 约束都没有）。配合
-- C2 的"行不存在就自动创建"，攻击者每次换一个新 bazi_key 字符串就能骗到
-- 一份全新"今日额度"：实测循环200次、每次传不同 p_bazi_key，从50灵气刷到
-- 3850灵气，凭空多出3800点，不需要绕过任何权限，公开 anon key + 自己的
-- JWT 在浏览器 devtools 里循环调用即可。变种攻击（真实 bazi_key + 伪造 wx
-- 值）同样成立。必须三条一起修，缺一条都堵不住。
--
-- ⚠️关键前提核查（务必记住，避免未来任何人想当然假设列名对得上）：
-- islands 表确实有一列叫 bazi_hash，看起来像是"命盘唯一标识"的权威来源，
-- 但实测全项目代码后发现这一列其实是个**从未被真正写入过的死列**——
-- js/user-state.js::baziKey(baziData) 才是全项目唯一被实际使用、被
-- wuxing_free_maintain()/wuxing_instant_fix()/redeem_wuxing_product() 的
-- p_bazi_key 参数真正传入的那份实现（年月日时干支拼接字符串，
-- js/wuxing-maintenance.js::_baziKeyOf() 直接复用它，没有第二份实现）；
-- 但 js/auth.js::saveIsland() 的两个调用点（js/main-new.js 约287行、
-- js/auth.js::_consumePendingIslandSave() 约1032行）全部把 baziHash 参数
-- 写死传 null，从未把这个值真正存进 islands.bazi_hash 列。也就是说如果
-- 按字面理解"校验 p_bazi_key 是否等于 islands.bazi_hash"，这条校验会
-- 100%失败（云端该列永远是 NULL），把所有合法请求也一并拦死。
-- 真正能验证"这条 bazi_key 确实归属调用者"的权威数据是 islands.bazi_data
-- 这个 JSONB 列——saveIsland() 把完整的 baziData 对象（含 pillars）存进
-- 这一列，从未省略。所以这里改为从 bazi_data->pillars 重新拼出与
-- js/user-state.js::baziKey() 完全一致的字符串来比对，而不是比对
-- bazi_hash。COALESCE 到空字符串是防御性写法：任何一段缺失都会导致拼出的
-- 字符串几乎不可能等于一个真实 p_bazi_key，天然拒绝而不是意外放行。
CREATE OR REPLACE FUNCTION bazi_key_belongs_to_caller(p_bazi_key TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM islands
    WHERE user_id = auth.uid()
      AND (
        COALESCE(bazi_data->'pillars'->'year'->>'stem', '')  ||
        COALESCE(bazi_data->'pillars'->'year'->>'branch', '') ||
        COALESCE(bazi_data->'pillars'->'month'->>'stem', '')  ||
        COALESCE(bazi_data->'pillars'->'month'->>'branch', '') ||
        COALESCE(bazi_data->'pillars'->'day'->>'stem', '')    ||
        COALESCE(bazi_data->'pillars'->'day'->>'branch', '')  ||
        COALESCE(bazi_data->'pillars'->'hour'->>'stem', '')   ||
        COALESCE(bazi_data->'pillars'->'hour'->>'branch', '')
      ) = p_bazi_key
  );
$$;
REVOKE ALL ON FUNCTION bazi_key_belongs_to_caller(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bazi_key_belongs_to_caller(TEXT) TO authenticated;

-- ── ① wx 加枚举校验 + ② bazi_key 归属校验 + ③ 每日免费维护总次数上限 ──
-- wuxing_free_maintain()：三条防线一起加。①②任一失败直接拒绝，无法进入
-- "行不存在就创建"这一步，从根源上不再有"随便传新字符串就能骗到新额度"
-- 这条路；③是即便①②被绕过（比如未来出现别的绕过手段）也兜底的硬天花板。
--
-- 2026-08-22 第六轮qa-reviewer复查订正：上一版这里写"一张命盘最多5行×2
-- 方向=10条五行问题"，是拍脑袋的理论组合数，不是真实判定逻辑算出来的。
-- 真正决定一张命盘会产生多少条五行问题的是 js/wuxing-issues.js::
-- deriveIssues()：只对 baziData.favorable / favorable2 / unfavorable 这
-- 三个命中五行分别产生最多一条（favorable===favorable2 时还会去重变
-- 少），跟命盘里五行×方向的理论组合数无关，**一张真实命盘最多只产生3条
-- 五行问题**，不是10条。10这个上限设得过松：既留了刷分空间（配合伪造
-- islands记录，见下方③的攻击面评估），又误伤了真实拥有4张以上命盘的
-- 正常用户（旧版按 user_id 不分命盘累计，第4张命盘当天第一次正常维护就
-- 会被误拒）。改为按 (user_id, bazi_key) 分别计数、上限收紧到3，既贴合
-- 真实业务上限，又不再跨命盘互相挤占额度。
--
-- ⚠️残余风险与本轮的补充决定（真实Postgres实测得出的结论，务必记住）：
-- islands 表的 INSERT 策略只检查 auth.uid()=user_id（见文件顶部"用户只能
-- 创建自己的岛屿"策略），不校验 bazi_data 内容真实性——攻击者仍可伪造N条
-- 虚假 islands 记录（每条 bazi_data->pillars 拼出不同 bazi_key），每条刷满
-- 3次。本地Postgres实测复现：给攻击者账号真实插入2条真实命盘（用满3次/
-- 命盘）+20条伪造命盘后循环刷，20条伪造命盘在几毫秒内全部刷满、净得480
-- 灵气——这不是"变慢"，而是**如果只加这条按bazi_key计数的上限、不保留任何
-- 按user_id的总量上限，攻击者的每日总收益会随伪造的islands行数线性无上限
-- 增长**（1000条伪造命盘理论上能刷2万+灵气/天），比修复前"10次/天硬顶
-- ≈110灵气"的旧上限（虽然计算口径错、会误伤多命盘正常用户，但好歹是个总量
-- 硬顶）反而更差。因此本轮**追加**一条独立的按user_id的总量硬顶（见下方
-- v_daily_count_total，30/天）作为兜底——30这个数字选取依据：真实产品里
-- deriveIssues()决定一张命盘最多3条问题，30相当于同一用户当天在10张不同
-- 命盘上都做满维护，远超真实重度用户的合理单日使用量（网页版"我的岛屿"
-- 面板允许保存多张，但同一天逐一维护10张的概率极低），但足以把伪造islands
-- 攻击的收益重新钉死在一个总量硬顶（p_tier/p_base_tier都是客户端可控的自由
-- 变量，clamp在1-3，取满时单次奖励是8+4*2+3=19，30次上限对应约240-570
-- 灵气/天的区间，不是任其无限
-- 增长。**这仍然不能彻底堵死"伪造islands记录"这条路**——只是把总量重新
-- 收回一个可控范围，真正堵死需要给 islands 表加类似"必须来自 /generate
-- 真实流水线"的写入限制（更大的架构改动，不在本轮任务范围内，留给业务方
-- 判断是否需要）。
-- 上限判定放在"该行是否已存在""是否shrine""是否今日已维护过"这些更具体
-- 的检查之后，避免把"重复维护同一行"这种本该有专属错误提示的情况误报成
-- "已达上限"。
CREATE OR REPLACE FUNCTION wuxing_free_maintain(p_bazi_key TEXT, p_wx TEXT, p_direction TEXT, p_tier SMALLINT, p_base_tier SMALLINT DEFAULT 1)
RETURNS TABLE(spirit_awarded INTEGER, new_balance INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row         wuxing_maintenance_state%ROWTYPE;
  v_tier        SMALLINT := GREATEST(1, LEAST(3, COALESCE(p_tier, 1)));
  v_award       INTEGER;
  v_balance     INTEGER;
  v_today       DATE := (now() AT TIME ZONE 'utc')::date;
  v_daily_count       INTEGER;
  v_daily_count_total INTEGER;
BEGIN
  IF p_wx NOT IN ('木','火','土','金','水') THEN
    RAISE EXCEPTION '无效的五行: %', p_wx;
  END IF;
  IF NOT bazi_key_belongs_to_caller(p_bazi_key) THEN
    RAISE EXCEPTION '无效的命盘标识';
  END IF;

  INSERT INTO wuxing_maintenance_state (user_id, bazi_key, wx, direction, base_tier)
    VALUES (auth.uid(), p_bazi_key, p_wx, p_direction, GREATEST(1, LEAST(3, COALESCE(p_base_tier, 1))))
  ON CONFLICT (user_id, bazi_key, wx, direction) DO NOTHING;

  SELECT * INTO v_row FROM wuxing_maintenance_state
    WHERE user_id = auth.uid() AND bazi_key = p_bazi_key AND wx = p_wx AND direction = p_direction
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到对应的维护状态记录'; END IF;
  IF v_row.ownership_tier = 'shrine' THEN RAISE EXCEPTION '该问题已永久巩固，无需维护'; END IF;
  IF v_row.last_free_maintain_date = v_today THEN
    RAISE EXCEPTION '今日已经维护过';
  END IF;

  SELECT COUNT(*) INTO v_daily_count FROM wuxing_maintenance_state
    WHERE user_id = auth.uid() AND bazi_key = p_bazi_key AND last_free_maintain_date = v_today;
  IF v_daily_count >= 3 THEN
    RAISE EXCEPTION '今日这张命盘的免费维护次数已达上限';
  END IF;

  -- 补充的按user_id总量硬顶：单独收窄按bazi_key的上限不会重新引入任何
  -- 按user_id的总量约束（伪造islands记录数量不受限，见上方⚠️注释里的实测
  -- 数据），这里独立再加一道，30是刻意设得远高于真实单日合理用量的数字，
  -- 不会误伤任何真实场景，只用来给"伪造大量islands记录"这条攻击封顶。
  SELECT COUNT(*) INTO v_daily_count_total FROM wuxing_maintenance_state
    WHERE user_id = auth.uid() AND last_free_maintain_date = v_today;
  IF v_daily_count_total >= 30 THEN
    RAISE EXCEPTION '今日免费维护总次数已达上限';
  END IF;

  v_award := 8 + 4 * (v_tier - 1) + (CASE WHEN v_row.base_tier = 3 THEN 3 ELSE 0 END);

  UPDATE wuxing_maintenance_state SET
    last_maintained_at      = NOW(),
    first_cycle_consumed    = TRUE,
    last_free_maintain_date = v_today,
    updated_at               = NOW()
  WHERE id = v_row.id;

  INSERT INTO profiles (id, spirit_balance) VALUES (auth.uid(), v_award)
  ON CONFLICT (id) DO UPDATE SET spirit_balance = COALESCE(profiles.spirit_balance, 0) + v_award
  RETURNING spirit_balance INTO v_balance;

  RETURN QUERY SELECT v_award, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION wuxing_free_maintain(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wuxing_free_maintain(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;

-- wuxing_instant_fix()：同样加①wx枚举校验+②bazi_key归属校验（这是付费
-- 路径，不需要③每日次数上限——花灵气的调理本来就受限于余额，不存在"无限
-- 刷分"这个问题，只有"伪造命盘标识/五行值"这个入口需要堵）。
CREATE OR REPLACE FUNCTION wuxing_instant_fix(p_bazi_key TEXT, p_wx TEXT, p_direction TEXT, p_tier SMALLINT, p_base_tier SMALLINT DEFAULT 1)
RETURNS TABLE(spirit_cost INTEGER, new_balance INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row     wuxing_maintenance_state%ROWTYPE;
  v_tier    SMALLINT := GREATEST(1, LEAST(3, COALESCE(p_tier, 1)));
  v_cost    INTEGER;
  v_balance INTEGER;
BEGIN
  IF p_wx NOT IN ('木','火','土','金','水') THEN
    RAISE EXCEPTION '无效的五行: %', p_wx;
  END IF;
  IF NOT bazi_key_belongs_to_caller(p_bazi_key) THEN
    RAISE EXCEPTION '无效的命盘标识';
  END IF;

  INSERT INTO wuxing_maintenance_state (user_id, bazi_key, wx, direction, base_tier)
    VALUES (auth.uid(), p_bazi_key, p_wx, p_direction, GREATEST(1, LEAST(3, COALESCE(p_base_tier, 1))))
  ON CONFLICT (user_id, bazi_key, wx, direction) DO NOTHING;

  SELECT * INTO v_row FROM wuxing_maintenance_state
    WHERE user_id = auth.uid() AND bazi_key = p_bazi_key AND wx = p_wx AND direction = p_direction
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到对应的维护状态记录'; END IF;
  IF v_row.ownership_tier = 'shrine' THEN RAISE EXCEPTION '该问题已永久巩固，无需调理'; END IF;

  v_cost := 15 + 15 * (v_tier - 1) + (CASE WHEN v_row.base_tier = 3 THEN 10 ELSE 0 END);

  UPDATE profiles SET spirit_balance = spirit_balance - v_cost
    WHERE id = auth.uid() AND spirit_balance >= v_cost
    RETURNING spirit_balance INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '灵气不足'; END IF;

  UPDATE wuxing_maintenance_state SET
    last_maintained_at   = NOW(), first_cycle_consumed = TRUE, updated_at = NOW()
  WHERE id = v_row.id;

  RETURN QUERY SELECT v_cost, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION wuxing_instant_fix(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wuxing_instant_fix(TEXT, TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;

-- redeem_wuxing_product()：同样加①wx枚举校验+②bazi_key归属校验；另外
-- P4——补上 shrine 态重复兑换重复扣款的守卫（行已存在且已是shrine才拒绝，
-- 行不存在/首次购买正常放行，不能把"从未维护过直接买"误判成"已经shrine"）。
CREATE OR REPLACE FUNCTION redeem_wuxing_product(
  p_product_id TEXT, p_bazi_key TEXT, p_wx TEXT, p_direction TEXT, p_base_tier SMALLINT,
  p_island_id UUID, p_trait_summary TEXT
) RETURNS TABLE(new_balance INTEGER, redemption_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cost          INTEGER;
  v_kind          TEXT;
  v_name          TEXT;
  v_wx_index      INTEGER;
  v_balance       INTEGER;
  v_redemption_id UUID;
  v_phone         TEXT;
  v_phone_code    TEXT;
  v_contact_phone TEXT;
BEGIN
  IF p_direction NOT IN ('nourish', 'restrain') THEN
    RAISE EXCEPTION '无效的direction: %', p_direction;
  END IF;
  IF p_wx NOT IN ('木','火','土','金','水') THEN
    RAISE EXCEPTION '无效的五行: %', p_wx;
  END IF;
  IF NOT bazi_key_belongs_to_caller(p_bazi_key) THEN
    RAISE EXCEPTION '无效的命盘标识';
  END IF;

  -- P4：该五行问题若已存在且已是 shrine 态，禁止重复兑换重复扣款；行不
  -- 存在（新用户从未维护过、直接购买）应正常放行。
  IF EXISTS (
    SELECT 1 FROM wuxing_maintenance_state
    WHERE user_id = auth.uid() AND bazi_key = p_bazi_key AND wx = p_wx AND direction = p_direction
      AND ownership_tier = 'shrine'
  ) THEN
    RAISE EXCEPTION '该问题已永久巩固，无需重复兑换';
  END IF;

  -- 与 js/products.js PRODUCT_DEFS 保持同步，改商品价格/新增商品时两边都要改
  SELECT cost, kind, name INTO v_cost, v_kind, v_name FROM (VALUES
    ('bracelet_rose',     'crystal', 200,  '粉水晶手链'),
    ('bracelet_obsidian', 'crystal', 250,  '黑曜石手链'),
    ('pillar_amethyst',   'crystal', 350,  '紫水晶柱'),
    ('basin_clear',       'crystal', 500,  '白水晶盆'),
    ('shrine_generic',    'shrine',  1000, '请神仙镇宅')
  ) AS t(product_id, kind, cost, name) WHERE t.product_id = p_product_id;

  IF v_cost IS NULL THEN RAISE EXCEPTION '未知商品: %', p_product_id; END IF;

  -- 复刻 js/products.js::WX_ORDER/_wxToIndex()，仅 crystal 路径需要（写入
  -- redemption_requests.trait_index 这个INTEGER列）；shrine路径不写这张表，
  -- 不需要这个映射合法，宽松放行任意wx。
  v_wx_index := CASE p_wx
    WHEN '木' THEN 0 WHEN '火' THEN 1 WHEN '土' THEN 2 WHEN '金' THEN 3 WHEN '水' THEN 4
    ELSE NULL
  END;
  IF v_kind = 'crystal' AND v_wx_index IS NULL THEN
    RAISE EXCEPTION '无效的wx: %', p_wx;
  END IF;

  UPDATE profiles SET spirit_balance = spirit_balance - v_cost
    WHERE id = auth.uid() AND spirit_balance >= v_cost
    RETURNING spirit_balance INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '灵气不足'; END IF;

  INSERT INTO wuxing_maintenance_state (user_id, bazi_key, wx, direction, base_tier, ownership_tier, ownership_product_id, last_maintained_at, first_cycle_consumed)
    VALUES (auth.uid(), p_bazi_key, p_wx, p_direction, GREATEST(1, LEAST(3, COALESCE(p_base_tier, 1))), v_kind, p_product_id, NOW(), TRUE)
  ON CONFLICT (user_id, bazi_key, wx, direction) DO UPDATE SET
    ownership_tier        = EXCLUDED.ownership_tier,
    ownership_product_id  = EXCLUDED.ownership_product_id,
    last_maintained_at     = NOW(),
    first_cycle_consumed   = TRUE,
    updated_at              = NOW();

  IF v_kind = 'crystal' THEN
    SELECT phone, phone_code INTO v_phone, v_phone_code FROM profiles WHERE id = auth.uid();
    v_contact_phone := NULLIF(TRIM(COALESCE(v_phone_code, '') || COALESCE(v_phone, '')), '');

    INSERT INTO redemption_requests (user_id, product_id, product_name, spirit_cost, island_id, trait_kind, trait_index, trait_summary, contact_phone)
      VALUES (auth.uid(), p_product_id, v_name, v_cost, p_island_id, p_direction, v_wx_index, p_trait_summary, v_contact_phone)
      RETURNING id INTO v_redemption_id;
  END IF;

  RETURN QUERY SELECT v_balance, v_redemption_id;
END;
$$;
REVOKE ALL ON FUNCTION redeem_wuxing_product(TEXT, TEXT, TEXT, TEXT, SMALLINT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_wuxing_product(TEXT, TEXT, TEXT, TEXT, SMALLINT, UUID, TEXT) TO authenticated;

-- ── C5-1 次要入口：INSERT 白名单里 base_tier/last_free_maintain_date 仍可
-- 被客户端直接写入，配合 INSERT 直接伪造 base_tier=3/last_free_maintain_
-- date=NULL 再调 RPC ─────────────────────────────────────────────────
-- 与 C3 修复 UPDATE 白名单同一个模式：表级 REVOKE INSERT 全部、再按新白
-- 名单重新 GRANT。⚠️没有照抄任务描述里"只保留 id, user_id, bazi_key, wx,
-- direction 五个基础字段"这句话本身：实测 js/auth.js::
-- syncWuxingMaintenanceState() 的真实 upsert payload（约452-470行）除了
-- 这5列外，还固定携带 last_maintained_at/first_cycle_consumed/updated_at
-- 三列——supabase-js 的 upsert 对 payload 里出现的全部列生成 INSERT 列表
-- （2026-08-19 qa-reviewer已用真实PostgREST源码证明过的规律，见上方"⚠️
-- UPDATE 白名单为什么要包含 id"那条注释）。若真按字面只留5列，这个函数
-- 唯一的合法调用点会在 INSERT 阶段就因为列权限不足直接报错，100%必现
-- "permission denied for table wuxing_maintenance_state"——这正是本文件反
-- 复强调、不要重蹈覆辙的那类坑（先用真实payload验证，不要凭直觉简化）。
-- 因此这里的 INSERT 白名单与当前 UPDATE 白名单保持一致（同样排除
-- base_tier/last_free_maintain_date/ownership_tier/ownership_product_id），
-- 只是刻意去掉这两个此前误留的敏感列，不动其余已验证过真实需要的列。
REVOKE INSERT ON wuxing_maintenance_state FROM authenticated, anon;
GRANT INSERT (id, user_id, bazi_key, wx, direction, last_maintained_at, first_cycle_consumed, updated_at)
  ON wuxing_maintenance_state TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2026-08-22 C5-2：base_tier 列没有 DEFAULT，导致 syncWuxingMaintenanceState()
-- 的 upsert 在 NOT NULL 约束检查阶段就失败——不是权限问题
-- ═══════════════════════════════════════════════════════════════
-- 背景：user-system 上一轮已按交接要求把 base_tier 从 upsert payload 里
-- 删掉（该列已被 C3 收进 UPDATE 白名单外，客户端不该再直接写它），但
-- base_tier SMALLINT NOT NULL 这一列本身没有 DEFAULT 值。INSERT ... ON
-- CONFLICT DO UPDATE 语句是先构造待插入的完整行、检查 NOT NULL/CHECK 约
-- 束，再判断是否冲突——哪怕云端那一行早就存在、语句本该走 DO UPDATE 分
-- 支，只要 INSERT 部分缺了 base_tier 的值就会在到达冲突判定之前直接报
-- "null value in column "base_tier" violates not-null constraint"。
-- 加 DEFAULT 1 后，INSERT 阶段用默认值1构造出合法待插入行、通过 NOT NULL
-- 检查，然后正常走到冲突判定、命中已存在的行、走 DO UPDATE 分支——
-- DO UPDATE SET 子句里本来就不含 base_tier（syncWuxingMaintenanceState()
-- payload 没有这一列），已存的 base_tier 值不会被这个默认值1覆盖。
ALTER TABLE wuxing_maintenance_state ALTER COLUMN base_tier SET DEFAULT 1;

-- ═══════════════════════════════════════════════════════════════
-- 2026-08-22 P5①：spend_spirit() 已无任何合法调用点，锁死执行权限
-- ═══════════════════════════════════════════════════════════════
-- js/products.js 已全部改用 redeem_wuxing_product() 原子兑换RPC，
-- spend_spirit(p_amount) 不再被任何合法前端流程调用。收回执行权限，保留
-- 函数体做审计痕迹（不删除，与本文件其它"锁死旧RPC"的一贯做法一致）。
REVOKE EXECUTE ON FUNCTION spend_spirit(INTEGER) FROM authenticated;
