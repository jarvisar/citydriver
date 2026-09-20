import * as THREE from 'three';

// The rig follows the game's camera; WebXR alone owns the camera underneath
// it. Moving the rig must never overwrite the headset's tracked pose.
export class XRCameraRig {
  constructor() {
    this.rig = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(60, 1, .1, 1200);
    this.rig.add(this.camera);
    this.origin = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.offset = new THREE.Vector3();
    this.centered = false;
  }
  recenter() { this.centered = false; }
  update(source, pose) {
    if (!this.centered && pose) {
      this.origin.copy(pose.transform.position);
      this.orientation.copy(pose.transform.orientation).invert();
      this.centered = true;
    }
    this.rig.position.copy(source.position);
    if (source.isOrthographicCamera) {
      // Match the overhead view's vertical framing at its focal plane using
      // a 60-degree perspective lens. The headset supplies the actual lenses.
      const distance = (source.top - source.bottom) / (2 * Math.tan(Math.PI / 6));
      source.getWorldDirection(this.offset);
      this.rig.position.addScaledVector(this.offset, source.userData.focusDistance - distance);
    }
    this.rig.quaternion.copy(source.quaternion).multiply(this.orientation);
    this.rig.position.sub(this.offset.copy(this.origin).applyQuaternion(this.rig.quaternion));
    this.rig.updateMatrixWorld(true);
  }
}
