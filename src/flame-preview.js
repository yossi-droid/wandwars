import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 100);
camera.position.set(4.1, 2.6, 5.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
document.body.prepend(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.65, 0.72, 0.04);
composer.addPass(bloom);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 2.2;
controls.maxDistance = 13;
controls.maxPolarAngle = Math.PI * 0.92;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;
renderer.domElement.addEventListener('pointerdown', () => {
  controls.autoRotate = false;
});

scene.add(new THREE.HemisphereLight(0x172d9b, 0x010107, 0.9));
const blueLight = new THREE.PointLight(0x071b8f, 18, 12, 1.8);
blueLight.position.set(0, 1.2, 0.5);
scene.add(blueLight);

let flame = null;
let mixer = null;
new GLTFLoader().load('/models/blue-flame.glb?v=more-glow-17', (gltf) => {
  flame = gltf.scene;
  flame.traverse((part) => {
    if (!part.isMesh || !part.material) return;
    const materials = Array.isArray(part.material) ? part.material : [part.material];
    for (const material of materials) {
      if ('emissiveIntensity' in material) material.emissiveIntensity *= 1.45;
    }
  });
  scene.add(flame);
  mixer = new THREE.AnimationMixer(flame);
  const clip = gltf.animations.find((animation) => animation.name === 'FlameFlicker');
  if (clip) mixer.clipAction(clip).play();
});

const clock = new THREE.Clock();
let lightTarget = 17;
let nextLightChange = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mixer) mixer.update(dt);
  nextLightChange -= dt;
  if (nextLightChange <= 0) {
    lightTarget = 14 + Math.random() * 6;
    nextLightChange = 0.025 + Math.random() * 0.05;
  }
  blueLight.intensity += (lightTarget - blueLight.intensity) * (1 - Math.exp(-22 * dt));
  controls.update();
  composer.render();
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
