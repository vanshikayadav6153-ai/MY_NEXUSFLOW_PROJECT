const particleCanvas = document.getElementById('particle-canvas');
if (particleCanvas) {
  const ctx = particleCanvas.getContext('2d');
  let width, height;
  let particles = [];
  let mouse = { x: null, y: null, radius: 150 };
  let hueShift = 0;
  let frameCount = 0;

  const PARTICLE_COUNT = 90;
  const CONNECTION_DIST = 180;
  const PARTICLE_SPEED = 0.4;

  function resize() {
    width = particleCanvas.width = window.innerWidth;
    height = particleCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('mouseout', () => {
    mouse.x = null;
    mouse.y = null;
  });

  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.size = Math.random() * 2 + 0.8;
      this.speedX = (Math.random() - 0.5) * PARTICLE_SPEED;
      this.speedY = (Math.random() - 0.5) * PARTICLE_SPEED;
      this.baseAlpha = Math.random() * 0.5 + 0.3;
      this.alpha = this.baseAlpha;
      this.hue = Math.random() > 0.5 ? 185 : 280;
      this.pulsePhase = Math.random() * Math.PI * 2;
    }

    update() {
      this.x += this.speedX;
      this.y += this.speedY;

      this.pulsePhase += 0.02;
      this.alpha = this.baseAlpha + Math.sin(this.pulsePhase) * 0.15;

      if (this.x < 0 || this.x > width) this.speedX *= -1;
      if (this.y < 0 || this.y > height) this.speedY *= -1;

      if (mouse.x !== null) {
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mouse.radius) {
          const force = (mouse.radius - dist) / mouse.radius;
          this.x += dx / dist * force * 2;
          this.y += dy / dist * force * 2;
        }
      }
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue + hueShift}, 100%, 70%, ${this.alpha})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue + hueShift}, 100%, 60%, ${this.alpha * 0.08})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }

  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECTION_DIST) {
          const opacity = (1 - dist / CONNECTION_DIST) * 0.25;
          ctx.beginPath();
          ctx.strokeStyle = `hsla(${190 + hueShift}, 100%, 60%, ${opacity})`;
          ctx.lineWidth = 0.6;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }

  let pulseRings = [];

  function spawnPulse(x, y) {
    pulseRings.push({ x, y, radius: 5, alpha: 0.6, maxRadius: 250 });
  }

  setInterval(() => {
    spawnPulse(width / 2, height / 2);
  }, 6000);

  function drawPulses() {
    for (let i = pulseRings.length - 1; i >= 0; i--) {
      const ring = pulseRings[i];
      ring.radius += 1.5;
      ring.alpha -= 0.004;

      if (ring.alpha <= 0 || ring.radius >= ring.maxRadius) {
        pulseRings.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${185 + hueShift}, 100%, 60%, ${ring.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  const hexagons = [];
  for (let i = 0; i < 6; i++) {
    hexagons.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 30 + 20,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.005,
      speedX: (Math.random() - 0.5) * 0.2,
      speedY: (Math.random() - 0.5) * 0.2,
      alpha: Math.random() * 0.06 + 0.02
    });
  }

  function drawHexagons() {
    hexagons.forEach(hex => {
      hex.x += hex.speedX;
      hex.y += hex.speedY;
      hex.rotation += hex.rotSpeed;

      if (hex.x < -50 || hex.x > width + 50) hex.speedX *= -1;
      if (hex.y < -50 || hex.y > height + 50) hex.speedY *= -1;

      ctx.save();
      ctx.translate(hex.x, hex.y);
      ctx.rotate(hex.rotation);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = hex.size * Math.cos(angle);
        const py = hex.size * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsla(${190 + hueShift}, 100%, 50%, ${hex.alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    frameCount++;

    hueShift = Math.sin(frameCount * 0.001) * 15;

    ctx.fillStyle = 'rgba(5, 8, 20, 0.15)';
    ctx.fillRect(0, 0, width, height);

    drawHexagons();
    drawConnections();
    drawPulses();

    particles.forEach(p => {
      p.update();
      p.draw();
    });
  }

  animate();

  window.spawnParticlePulse = (x, y) => {
    spawnPulse(x || width / 2, y || height / 2);
  };
}
