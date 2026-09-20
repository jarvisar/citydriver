import * as THREE from 'three';

// DOM menus are not visible in immersive VR. Only draw a small status card
// when stopped; settings remain available on the browser page after exiting.
export class VRStatus {
  constructor(camera) { this.camera = camera; this.status = ''; }
  update(status) {
    if (status === this.status) return;
    this.status = status;
    if (!status) { if (this.mesh) this.mesh.visible = false; return; }
    if (!this.mesh) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024; this.canvas.height = 256;
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .4), new THREE.MeshBasicMaterial({ map: this.texture, depthTest: false, depthWrite: false, toneMapped: false }));
      this.mesh.position.set(0, -.3, -2); this.mesh.renderOrder = 1000;
      this.mesh.frustumCulled = false; this.camera.add(this.mesh);
    }
    const context = this.canvas.getContext('2d');
    context.fillStyle = '#183b34'; context.fillRect(0, 0, 1024, 256);
    context.fillStyle = '#f6f5ea'; context.textAlign = 'center';
    context.font = 'bold 48px sans-serif';
    context.fillText(status === 'loading' ? 'Loading road…' : 'Paused', 512, 76);
    context.font = '28px sans-serif';
    context.fillText(status === 'loading' ? 'Your drive will be ready shortly' : 'B: resume · A: camera · Y: exit VR', 512, 140);
    context.fillText('Left stick: steer · Right trigger: gas · Left trigger: brake', 512, 198);
    this.texture.needsUpdate = true; this.mesh.visible = true;
  }
}
