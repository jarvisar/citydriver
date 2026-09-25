import * as THREE from 'three';

const bounds = new THREE.Box3(), point = new THREE.Vector3(), direction = new THREE.Vector3();

export function stabilizeShadowFiltering() {
  // Three's PCF rotates its taps per screen pixel, which crawls on camera motion
  // without TAA. Swap in a fixed 3x3 tent filter; hardware bilinear filtering
  // blends each tap.
  THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replaceAll(
    'interleavedGradientNoise( gl_FragCoord.xy ) * PI2', '0.0').replace(
    /shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \)[\s\S]*?\) \* 0\.2;/,
    `vec2 stepSize = texelSize * shadowRadius * 0.5;
    shadow = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      shadow += texture(shadowMap, vec3(shadowCoord.xy + vec2(float(x), float(y)) * stepSize, shadowCoord.z)) * weight;
    }
    shadow *= 0.0625;`);
}

// Fit the sun's shadow camera to the visible terrain. `heightOrigin` shifts the
// covered height band with the local elevation without changing texel density.
export function fitSunShadow(camera, sun, heightOrigin = 0, worldOrigin = 0) {
  camera.updateMatrixWorld();
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  sun.shadow.updateMatrices(sun);
  const lightCamera = sun.shadow.camera;
  bounds.makeEmpty();
  if (camera.isPerspectiveCamera) {
    // A bounding sphere depends only on the lens, so turning the camera cannot
    // stretch the shadow texels.
    const far = Math.min(100, camera.far);
    const slope = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
    const middle = Math.min(far, (camera.near + far) * (1 + slope * slope * (1 + camera.aspect * camera.aspect)) / 2);
    const halfHeight = far * slope;
    const radius = Math.ceil(Math.hypot(halfHeight * camera.aspect, halfHeight, far - middle) * 16) / 16;
    camera.getWorldDirection(point).multiplyScalar(middle).add(camera.position);
    point.applyMatrix4(lightCamera.matrixWorldInverse);
    bounds.min.copy(point).addScalar(-radius);
    bounds.max.copy(point).addScalar(radius);
  } else {
    camera.getWorldDirection(direction);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const height of [-40, 180]) {
      point.set(x, y, -1).unproject(camera);
      point.addScaledVector(direction, (heightOrigin + height - point.y) / direction.y);
      bounds.expandByPoint(point.applyMatrix4(lightCamera.matrixWorldInverse));
    }
  }
  // Leave a border for filtering and depth room for offscreen casters.
  const padding = 24;
  const width = Math.ceil((bounds.max.x - bounds.min.x + padding * 2) * 16) / 16;
  const height = Math.ceil((bounds.max.y - bounds.min.y + padding * 2) * 16) / 16;
  const texelX = width / sun.shadow.mapSize.x, texelY = height / sun.shadow.mapSize.y;
  // Snap to whole texels relative to the absolute world origin (including
  // floating-origin rebases) so shadow edges don't shimmer as the camera moves.
  point.set(0, 0, worldOrigin).applyMatrix4(lightCamera.matrixWorldInverse);
  const centerX = point.x + Math.round(((bounds.min.x + bounds.max.x) / 2 - point.x) / texelX) * texelX;
  const centerY = point.y + Math.round(((bounds.min.y + bounds.max.y) / 2 - point.y) / texelY) * texelY;
  lightCamera.left = centerX - width / 2;
  lightCamera.right = centerX + width / 2;
  lightCamera.bottom = centerY - height / 2;
  lightCamera.top = centerY + height / 2;
  lightCamera.near = -bounds.max.z - 250;
  lightCamera.far = -bounds.min.z + 250;
  lightCamera.updateProjectionMatrix();
}
