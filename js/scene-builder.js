/**
 * scene-builder.js · 根据八字数据构建 Three.js 3D 场景
 *
 * 主要职责：
 *  - 初始化 Three.js 场景、相机、渲染器
 *  - 接收八字数据，动态生成对应五行比例的场景
 *  - 管理 3D 模型加载（GLB 格式）
 *  - 输出：scene, camera, renderer 供其他模块使用
 *
 * 阶段：
 *  - 当前（scaffold）：基础场景框架，placeholder 几何体代替真实模型
 *  - 阶段1完成后：替换为真实 GLB 模型
 *  - 阶段2：加入五行旺衰驱动的动态生成逻辑
 */

class SceneBuilder {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.animFrameId = null;
  }

  /** 初始化 Three.js 基础设施 */
  init() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(
      CONFIG.SCENE.fogColor,
      CONFIG.SCENE.fogNear,
      CONFIG.SCENE.fogFar
    );
    this.scene.background = new THREE.Color(CONFIG.SCENE.fogColor);

    // Camera
    this.camera = new THREE.PerspectiveCamera(CONFIG.SCENE.cameraFov, w / h, 0.1, 1000);
    this.camera.position.set(0, 8, CONFIG.SCENE.cameraZ);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // 光照
    const ambient = new THREE.AmbientLight(0xffffff, CONFIG.SCENE.ambientIntensity);
    this.scene.add(ambient);

    const sunLight = new THREE.DirectionalLight(0xfff8e8, 1.2);
    sunLight.position.set(10, 20, 10);
    sunLight.castShadow = true;
    this.scene.add(sunLight);

    // 响应窗口大小变化
    window.addEventListener('resize', () => this._onResize());

    return this;
  }

  /**
   * 根据八字数据生成场景
   * @param {Object} baziData - 来自 API 的八字命盘数据
   * TODO 阶段2：实现五行旺衰驱动的真实场景生成
   */
  buildFromBazi(baziData) {
    this._clearScene();
    this._buildPlaceholderScene(baziData);
    return this;
  }

  /** 占位场景（阶段1前使用）：5个彩色方块代表五行 */
  _buildPlaceholderScene(baziData) {
    const wuxing = ['木', '火', '土', '金', '水'];
    const positions = [[-4,0,-2],[4,0,-2],[0,0,2],[-2,0,-4],[2,0,-4]];

    wuxing.forEach((wx, i) => {
      const color = new THREE.Color(CONFIG.WUXING_COLORS[wx].primary);
      const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...positions[i]);
      mesh.userData = { wuxing: wx };
      this.scene.add(mesh);
    });

    // 地面
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.76;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** 清空场景中的动态对象 */
  _clearScene() {
    const toRemove = [];
    this.scene.traverse(obj => {
      if (obj.userData && obj.userData.wuxing) toRemove.push(obj);
    });
    toRemove.forEach(obj => this.scene.remove(obj));
  }

  /** 动画循环 */
  startRenderLoop(onFrame) {
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      if (onFrame) onFrame();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
