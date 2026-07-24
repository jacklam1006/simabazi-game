/**
 * annotation.js · 3D 场景内可点击标注系统
 *
 * 职责：
 *  - 在 3D 场景中生成"箭头 + 标签"标注点
 *  - 用户点击标注 → 弹出命盘分析卡片
 *  - 标注按类型分级：danger（红）/ fortune（金）/ neutral（灰）
 *
 * TODO 阶段2：接入真实八字分析数据动态生成标注
 */

class AnnotationSystem {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.annotations = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this._bindEvents();
  }

  /**
   * 从八字分析数据生成标注
   * @param {Array} points - [{position, type, title, content}, ...]
   */
  buildFromAnalysis(points) {
    this._clearAnnotations();
    points.forEach(p => this._createAnnotation(p));
  }

  _createAnnotation({ position, type = 'neutral', title, content }) {
    const colors = { danger: 0xEB5757, fortune: 0xC9A96E, neutral: 0x888888 };
    const color = colors[type] || colors.neutral;

    // 球形标注点
    const geo = new THREE.SphereGeometry(0.15, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 });
    const marker = new THREE.Mesh(geo, mat);
    marker.position.set(...position);
    marker.userData = { isAnnotation: true, title, content, type };
    this.scene.add(marker);
    this.annotations.push(marker);
  }

  _clearAnnotations() {
    this.annotations.forEach(a => this.scene.remove(a));
    this.annotations = [];
  }

  _bindEvents() {
    this.renderer.domElement.addEventListener('click', (e) => this._onClick(e));
  }

  _onClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(this.annotations);
    if (hits.length > 0) {
      const data = hits[0].object.userData;
      this._showCard(data);
    }
  }

  /** 显示分析卡片（TODO 阶段2：替换为精美 UI 组件）*/
  _showCard({ title, content, type }) {
    // 占位弹窗，后续替换为精美卡片
    alert(`【${title}】\n\n${content}`);
  }
}
