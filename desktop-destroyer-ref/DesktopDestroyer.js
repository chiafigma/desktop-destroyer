/* eslint-disable complexity */
import { configure } from "../../../../42/api/configure.js"
import { loadArrayBuffer } from "../../../../42/api/load/loadArrayBuffer.js"
import { Canceller } from "../../../../42/lib/class/Canceller.js"
import { line } from "../../../../42/lib/geometry/line.js"
import { inRect } from "../../../../42/lib/geometry/point.js"
import { Scene } from "../../../../42/lib/graphic/Scene.js"
import { Timer } from "../../../../42/lib/timing/Timer.js"
import { isHashmapLike } from "../../../../42/lib/type/any/isHashmapLike.js"
import { clamp } from "../../../../42/lib/type/number/math.js"
import { randomItem } from "../../../../42/lib/type/array/randomItem.js"
import { randomInteger } from "../../../../42/lib/type/number/random.js"

// MARK: Sprite
// ============

class Sprite {
  x = 0
  y = 0

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {string | HTMLImageElement} src
   * @param {any} options
   */
  constructor(context, src, options) {
    this.context = context
    this.canvas = context.canvas
    this.frame = options?.frame ?? 0
    this.state = options?.state ?? 0
    this.frames = options?.frames ?? 1
    this.states = options?.states ?? 1
    this.offset = options?.offset ?? { x: 0, y: 0 }
    this.x = options?.x ?? 0
    this.y = options?.y ?? 0
    this.centered = options?.centered ?? false
    if (typeof src === "string") {
      this.image = new Image()
      this.image.src = src
    } else {
      this.image = src
      this.initSize()
    }
  }

  initSize() {
    this.width = this.image.naturalWidth
    this.height = this.image.naturalHeight
    this.frameWidth = this.width / this.frames
    this.frameHeight = this.height / this.states
    this.centerX = this.centered ? Math.round(this.frameWidth / 2) : 0
    this.centerY = this.centered ? Math.round(this.frameHeight / 2) : 0
  }

  async init() {
    await this.image.decode()
    this.initSize()
  }

  draw(x = this.x, y = this.y) {
    this.x = x
    this.y = y
    this.context.drawImage(
      this.image,
      this.frame * this.frameWidth,
      this.state * this.frameHeight,
      this.frameWidth,
      this.frameHeight,
      this.x - this.centerX + this.offset.x,
      this.y - this.centerY + this.offset.y,
      this.frameWidth,
      this.frameHeight,
    )
  }

  place(x, y) {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.draw(x, y)
  }
}

class Particle extends Sprite {
  /**
   * @param {CanvasRenderingContext2D} context
   * @param {string | HTMLImageElement} src
   * @param {any} options
   */
  constructor(context, src, options) {
    super(context, src, options)
    this.gravity = options?.gravity ?? 0
    this.velocityX = options?.velocityX ?? 0
    this.velocityY = options?.velocityY ?? 0

    this.moving = Boolean(this.gravity || this.velocityX || this.velocityY)

    if (Array.isArray(this.velocityX)) {
      this.velocityX = randomInteger(...this.velocityX)
    }
    if (Array.isArray(this.velocityY)) {
      this.velocityY = randomInteger(...this.velocityY)
    }
  }

  move() {
    this.x += this.velocityX
    this.y += this.velocityY
    if (this.gravity) this.velocityY += this.gravity

    if (
      this.y > this.context.canvas.height ||
      this.x > this.context.canvas.width
    ) {
      this.moving = false
    }
  }
}

// MARK: Termite
// =============

const termites = new Set()
let termiteImage
let deadTermite
let termiteSound
let deadTermiteSound
class Termite extends Sprite {
  static async init() {
    termiteImage = new Image()
    termiteImage.src = "./assets/7-termite/termite.png"

    deadTermite = new Image()
    deadTermite.src = "./assets/7-termite/dead-termite.png"

    loadArrayBuffer("./assets/7-termite/termite.ogg") //
      .then((buf) => game.audioContext.decodeAudioData(buf))
      .then((buf) => {
        termiteSound = buf
      })

    loadArrayBuffer("./assets/7-termite/dead-termite.ogg") //
      .then((buf) => game.audioContext.decodeAudioData(buf))
      .then((buf) => {
        deadTermiteSound = buf
      })

    return Promise.all([
      termiteImage.decode(),
      deadTermite.decode(),
      termiteSound,
      deadTermiteSound,
    ])
  }

  constructor(game, x, y) {
    super(game.termiteScene.context, termiteImage, {
      x,
      y,
      centered: true,
      frames: 2,
      states: 8,
      state: 2,
    })

    this.moving = false
    this.dirX = 0
    this.dirY = 0

    this.game = game

    this.game.termiteSound ??= this.game.playSound({
      buffer: termiteSound,
      loop: true,
    })
    this.game.termiteTimer ??= new Timer(
      () => {
        game.termiteScene.clear()
        for (const termite of termites) termite.move()
        if (termites.size === 0) {
          this.game.termiteSound.stop()
          this.game.termiteSound = undefined
          this.game.termiteTimer.stop()
          this.game.termiteTimer = undefined
        }
      },
      { interval: 180, autoStart: true, signal: game.signal },
    )

    this.draw()
  }

  setState() {
    const { dirX, dirY } = this

    if (Math.abs(dirY) < 2) {
      this.state =
        (dirX <= 0
          ? 6 // left
          : 4) + // right
        (this.moving ? 0 : -4)
    } else {
      this.state =
        (dirY < 0
          ? 5 // up
          : 7) + // down
        (this.moving ? 0 : -4)
    }
  }

  move() {
    const x = this.x + this.dirX + (this.moving ? randomInteger(-1, 1) : 0)
    const y = this.y + this.dirY + (this.moving ? randomInteger(-1, 1) : 0)

    const globalComposite =
      this.game.impactScene.context.globalCompositeOperation
    this.game.impactScene.context.globalCompositeOperation = "source-over"
    for (const point of line(this.x, this.y, x, y)) {
      this.game.impactScene.context.fillRect(point.x, point.y, 4, 4)
    }
    this.game.impactScene.context.globalCompositeOperation = globalComposite

    this.x = x
    this.y = y

    this.frame++
    if (this.frame >= this.frames) this.frame = 0
    this.draw()

    if (Math.random() > 0.7) {
      this.moving = !this.moving
      if (this.moving) {
        this.dirX = randomInteger(-2, 2)
        this.dirY = randomInteger(-2, 2)
      } else {
        this.dirX = 0
        this.dirY = 0
      }
      this.setState()
    }
  }

  kill() {
    termites.delete(this)
    this.game.playSound({ buffer: deadTermiteSound, x: this.x - this.centerX })
    this.game.impactScene.context.drawImage(
      deadTermite,
      this.x - this.centerX,
      this.y - this.centerY,
    )
  }
}

// MARK: Weapon
// ============

const DEFAULT_WEAPON = {
  fireRate: 1,
  cursorUpFrames: 1,
  cursorDownFrames: 1,
  dispersion: 0,
  stopOnRelease: true,
  cursorOffset: { x: 0, y: 0 },
}

class Weapon {
  #cancel

  paused = false

  sounds = {}
  hits = []
  drops = []

  /** @type {Set<Particle>} */
  particles = new Set()

  /**
   * @param {Game} game
   * @param {any} options
   */
  constructor(game, options) {
    this.game = game
    this.name = options.name
    this.config = configure(DEFAULT_WEAPON, options)

    this.isWhashing = this.name === "Washing"
    this.isChainsaw = this.name === "Chain-Saw"
    this.isTermite = this.name === "Termite"
  }

  resetLoop() {
    this.loop = this.config.fireLoop === true ? Infinity : this.config.fireLoop
  }

  async init() {
    const { signal, cancel } = new Canceller()
    this.signal = signal
    this.#cancel = cancel

    this.resetLoop()

    this.cursorUp = new Sprite(
      this.game.cursorScene.context,
      this.config.dir + "cursor-release.png",
      {
        frames: this.config.cursorUpFrames,
        states: this.config.cursorUpStates,
      },
    )

    if (this.config.cursorUpFrames > 1) {
      this.cursorUpTimer = new Timer(
        () => {
          this.cursorUp.frame++
          if (this.cursorUp.frame >= this.cursorUp.frames) {
            this.cursorUp.frame = 0
          }
          this.draw()
        },
        this.config.cursorUpRate ?? this.config.fireRate,
        { signal },
      )
    }

    if (this.config.cursorDownFrames > 0) {
      this.cursorDown = new Sprite(
        this.game.cursorScene.context,
        this.config.dir + "cursor-press.png",
        {
          frames: this.config.cursorDownFrames,
          states: this.config.cursorDownStates,
        },
      )

      if (this.config.cursorDownFrames > 1) {
        this.cursorDownTimer = new Timer(
          () => {
            this.isFiring = true
            this.cursorDown.frame++
            if (this.cursorDown.frame >= this.cursorDown.frames) {
              this.cursorDown.frame = 0
              this.loop--

              if (
                !(
                  this.loop > 0 &&
                  (this.game.pointer.pressed ||
                    this.config.stopOnRelease === false)
                )
              ) {
                this.isFiring = false
                this.resetLoop()
                this.cursorDownTimer.stop()
              }
            }
            this.hit()
            this.draw()
          },
          this.config.fireRate,
          { signal },
        )
      }
    } else if (this.config.fireRate) {
      this.cursorDownTimer = new Timer(
        () => {
          this.hit()
        }, //
        this.config.fireRate,
        { signal },
      )
    }

    /** @type {any[]} */
    const undones = [
      this.cursorUp.init(), //
      this.cursorDown?.init(),
    ]

    if (this.config.hits) {
      const hits = []
      for (let i = 1; i < this.config.hits + 1; i++) {
        const img = new Image()
        img.src = `${this.config.dir}hit-${i}.png`
        hits.push(
          img.decode().then(() => {
            this.hits.push(img)
          }),
        )
      }
      undones.push(Promise.all(hits))
    }

    if (this.config.drops) {
      const obj = isHashmapLike(this.config.drops)
        ? this.config.drops
        : { count: this.config.drops }
      const drops = []
      for (let i = 1; i < obj.count + 1; i++) {
        const image = new Image()
        image.src =
          obj.count > 1
            ? `${this.config.dir}drop-${i}.png`
            : `${this.config.dir}drop.png`

        drops.push(
          image.decode().then(() => {
            this.drops.push({ image, ...obj })
          }),
        )
      }
      undones.push(Promise.all(drops))
    }

    if (this.config.fireFrames) {
      this.fireImage = new Image()
      this.fireImage.src = this.config.dir + "press.png"
      undones.push(this.fireImage.decode())
    }

    if (this.config.fireFrames || this.config.drops) {
      this.particlesTimer = new Timer(
        () => {
          // console.log("particlesTimer")
          this.game.particulesScene.clear()
          for (const p of this.particles) {
            p.draw()
            p.move()

            if (!(p.frames === 1 && p.moving)) p.frame++

            if (p.frame >= p.frames) {
              if (p.moving) p.frame = 0
              else {
                if (p.gravity && this.sounds.drop) {
                  this.game.playSound({
                    ...randomItem(this.sounds.drop),
                    x: p.x,
                  })
                }
                this.particles.delete(p)
              }
            }
          }
        },
        50,
        { signal: this.signal },
      )

      this.particlesTimer.start()
    }

    if (this.config.sounds) {
      for (const [key, val] of Object.entries(this.config.sounds)) {
        /** @type {any} */
        const obj = isHashmapLike(val) ? { ...val } : { count: val }

        obj.name ??= key
        obj.loop ??= false
        obj.stereo ??= true
        obj.count ??= 1

        this.sounds[key] = []

        for (let i = 1; i < obj.count + 1; i++) {
          const out = { ...obj }
          const path =
            out.count > 1
              ? `${this.config.dir}${key}-${i}.ogg`
              : `${this.config.dir}${key}.ogg`

          out.path = path

          undones.push(
            loadArrayBuffer(path).then(async (buf) => {
              out.buffer = await this.game.audioContext.decodeAudioData(buf)
              this.sounds[key].push(out)
            }),
          )
        }
      }
    }

    if (this.isTermite) {
      undones.push(Termite.init())
    }

    await Promise.all(undones)

    if (this.signal.aborted) return

    if (this.sounds.release && this.sounds.release[0].loop) {
      this.releaseSound = this.game.playSound(this.sounds.release[0])
    }

    this.cursorUpTimer?.start()
    this.draw()
  }

  spawnParticle(image, options) {
    const sprite = new Particle(
      this.game.particulesScene.context,
      image,
      options,
    )
    this.particles.add(sprite)
    return sprite
  }

  hit() {
    let { x, y } = this.game.pointer

    this.game.impactScene.context.globalCompositeOperation = this.isWhashing
      ? "destination-out"
      : "source-over"

    if (this.isChainsaw) {
      if (this.prevPointer) {
        let dirX = x - this.prevPointer.x
        let dirY = y - this.prevPointer.y

        if (Math.abs(dirX) < 4) dirX = 0
        if (Math.abs(dirY) < 4) dirY = 0

        if (!(dirX === 0 && dirY === 0)) {
          this.cursorDown.state =
            dirX === 0
              ? dirY < 0
                ? 2 // up
                : 6 // down
              : dirX > 0
                ? dirY === 0
                  ? 0 // right
                  : dirY < 0
                    ? 1 // up right
                    : 7 // down right
                : dirY === 0
                  ? 4 // left
                  : dirY < 0
                    ? 3 // up left
                    : 5 // down left
        }

        for (const point of line(
          this.prevPointer.x,
          this.prevPointer.y,
          x,
          y,
        )) {
          this.game.impactScene.context.fillRect(point.x, point.y, 2, 2)
        }
      } else this.game.impactScene.context.fillRect(x, y, 2, 2)
      this.prevPointer = { x, y }
    } else if (this.isTermite) {
      termites.add(new Termite(this.game, x, y))
    }

    if (this.config.dispersion) {
      let dispersionX = Math.round(Math.random() * this.config.dispersion)
      let dispersionY = Math.round(Math.random() * this.config.dispersion)
      if (Math.random() > 0.5) dispersionX = -dispersionX
      if (Math.random() > 0.5) dispersionY = -dispersionY

      x += dispersionX
      y += dispersionY
    }

    if (this.fireImage) {
      this.spawnParticle(this.fireImage, {
        x,
        y,
        centered: true,
        frames: this.config.fireFrames,
      })
    }

    if (this.drops.length > 0) {
      let l = this.config.drops.drop ?? 1
      if (Array.isArray(l)) l = randomInteger(...l)
      for (let i = 0; i < l; i++) {
        const { image, ...rest } = randomItem(this.drops)
        this.spawnParticle(image, { x, y, ...rest })
      }
    }

    if (this.sounds.hit) {
      this.game.playSound(randomItem(this.sounds.hit))
    }

    let killRect

    if (this.hits.length > 0) {
      const img = randomItem(this.hits)

      x -= img.width / 2
      y -= img.height / 2

      killRect = {
        left: x,
        top: y,
        right: x + img.width,
        bottom: y + img.width,
      }

      this.game.impactScene.context.drawImage(img, x, y)
    } else {
      killRect = {
        left: x,
        top: y,
        right: x + 10,
        bottom: y + 10,
      }
    }

    if (!this.isWhashing && !this.isTermite) {
      for (const termite of termites) {
        if (inRect(termite, killRect, this.config.killMargin)) {
          termite.kill()
        }
      }
    }
  }

  draw() {
    let { x, y } = this.game.pointer
    x += this.config.cursorOffset.x
    y += this.config.cursorOffset.y

    if (this.isFiring && this.cursorDown) this.cursorDown.place(x, y)
    else this.cursorUp.place(x, y)

    if (this.releaseSound?.stereo || this.pressSound?.stereo) {
      const pan = this.game.getStereo()
      this.releaseSound?.panner.pan.setValueAtTime(pan, 0)
      this.pressSound?.panner.pan.setValueAtTime(pan, 0)
    }
  }

  press() {
    if (this.config.cursorDownFrames === 1) this.isFiring = true

    this.cursorUpTimer?.stop()
    this.draw()

    if (this.cursorDownTimer) {
      this.cursorDownTimer.start()
    } else {
      this.hit()
    }

    this.releaseSound?.stop()
    if (this.sounds.press) {
      this.pressSound?.stop()
      this.pressSound = this.game.playSound(this.sounds.press[0])
    }
  }

  release() {
    this.prevPointer = undefined

    if (this.cursorDown) this.cursorDown.state = 0

    if (this.sounds.press?.[0].loop) {
      this.pressSound?.stop()
    }

    if (this.sounds.release && this.isFiring) {
      this.releaseSound?.stop()
      this.releaseSound = this.game.playSound(this.sounds.release[0])
    }

    if (this.config.stopOnRelease) {
      this.isFiring = false
      this.cursorDownTimer?.stop()
      if (this.cursorUpTimer) this.cursorUpTimer.start()
      this.draw()
    }
  }

  play() {
    this.paused = false
    this.cursorUpTimer?.play()
    this.cursorDownTimer?.play()
    this.particlesTimer?.play()
  }

  pause() {
    this.paused = true
    this.cursorUpTimer?.pause()
    this.cursorDownTimer?.stop()
    this.particlesTimer?.pause()
  }

  togglePause(force = !this.paused) {
    if (force) this.pause()
    else this.play()
  }

  destroy() {
    this.#cancel?.()
    this.particles.clear()
    this.pressSound?.stop()
    this.releaseSound?.stop()
    this.game.cursorScene.clear()
    this.game.particulesScene.clear()
  }
}

// MARK: Game
// ==========

class Game {
  #cancel

  paused = false

  pointer = { x: 0, y: 0, pressed: false }

  /** @type {Timer} */
  termiteTimer

  /** @type {Weapon} */
  weapon

  constructor(options) {
    this.impactScene = new Scene({ willReadFrequently: true })
    this.termiteScene = new Scene()
    this.particulesScene = new Scene()
    this.cursorScene = new Scene()

    this.style = document.createElement("style")
    this.style.textContent = /* css */ `
      #desktop-destroyer {
        display: grid;
        position: fixed;
        inset: 0;
        > canvas {
          image-rendering: pixelated;
          grid-area: 1 / 1;
        }
      }`

    this.el = document.createElement("div")
    this.el.id = "desktop-destroyer"
    this.el.append(
      this.style, //
      this.impactScene.canvas,
      this.termiteScene.canvas,
      this.particulesScene.canvas,
      this.cursorScene.canvas,
    )
    document.body.append(this.el)

    this.weaponIdx = options?.weapon ?? 0
    this.weapons = (options?.weapons ?? weapons).map(
      (weaponInit) => new Weapon(this, weaponInit),
    )

    const { signal, cancel } = new Canceller()
    this.signal = signal
    this.#cancel = cancel
  }

  ready
  async init() {
    if (this.ready) return
    this.ready = true

    this.audioContext = new AudioContext()

    const { signal } = this
    await this.setWeapon(this.weaponIdx)

    let inContextMenu = false
    window.addEventListener(
      "contextmenu", //
      (e) => {
        e.preventDefault()
        inContextMenu = true
      },
      { signal },
    )

    this.el.addEventListener(
      "pointermove",
      ({ x, y }) => {
        this.pointer.x = x
        this.pointer.y = y
        if (this.paused) return
        this.weapon?.draw()
      },
      { signal },
    )

    this.el.addEventListener(
      "pointerdown",
      ({ x, y, buttons }) => {
        if (buttons !== 1) return
        this.pointer.x = x
        this.pointer.y = y
        if (this.paused) return
        this.pointer.pressed = true
        this.weapon?.press()
      },
      { signal },
    )

    this.el.addEventListener(
      "pointerup",
      ({ x, y }) => {
        if (inContextMenu) {
          inContextMenu = false
          return
        }
        this.pointer.x = x
        this.pointer.y = y
        if (this.paused) return
        this.pointer.pressed = false
        this.weapon?.release()
      },
      { signal },
    )

    this.el.addEventListener(
      "wheel",
      ({ deltaY }) => {
        if (this.paused) return
        if (deltaY > 0) this.weaponDown()
        else this.weaponUp()
      },
      { signal },
    )

    window.addEventListener(
      "resize",
      () => {
        const { width, height } = this.impactScene
        const image = this.impactScene.context.getImageData(0, 0, width, height)
        this.impactScene.setSize(window.innerWidth, window.innerHeight)
        this.impactScene.context.putImageData(image, 0, 0)

        this.termiteScene.setSize(window.innerWidth, window.innerHeight)
        this.particulesScene.setSize(window.innerWidth, window.innerHeight)
        this.cursorScene.setSize(window.innerWidth, window.innerHeight)

        this.weapon?.draw()
      },
      { signal },
    )
  }

  async setWeapon(idx) {
    this.cursorScene.canvas.style.cursor = "var(--cursor-progress, progress)"
    this.weapon?.destroy()
    this.weapon = undefined
    this.weaponIdx = idx
    const weapon = this.weapons[this.weaponIdx]
    await weapon.init()
    this.weapon?.destroy()
    this.weapon = weapon
    this.cursorScene.canvas.style.cursor = "none"
    return this.weapon
  }

  async weaponUp() {
    this.weaponIdx++
    if (this.weaponIdx >= this.weapons.length) {
      this.weaponIdx = 0
    }
    await this.setWeapon(this.weaponIdx)
  }

  async weaponDown() {
    this.weaponIdx--
    if (this.weaponIdx < 0) {
      this.weaponIdx = this.weapons.length - 1
    }
    await this.setWeapon(this.weaponIdx)
  }

  getStereo(x = this.pointer.x) {
    // calculate where the sound origin is relative to the center of the viewport (-1 to 1)
    const w = this.impactScene.width
    const pan = -((Math.round(w / 2) - x) / w) * 2
    return clamp(pan, -1, 1)
  }

  playSound({ buffer, loop, stereo, x }) {
    const pan = x ? this.getStereo(x) : stereo ? this.getStereo() : 0
    const ctx = this.audioContext

    const source = new AudioBufferSourceNode(ctx, { buffer, loop })
    const panner = new StereoPannerNode(ctx, { pan })
    const volume = new GainNode(ctx, { gain: 0.5 })

    source.start()
    source //
      .connect(volume)
      .connect(panner)
      .connect(ctx.destination)

    return {
      stereo,
      panner: stereo ? panner : undefined,
      stop() {
        source.stop()
        source.disconnect()
        volume.disconnect()
        panner.disconnect()
      },
    }
  }

  play() {
    this.paused = false
    this.weapon?.play()
    this.termiteTimer?.play()
    this.cursorScene.canvas.style.cursor = "none"
  }

  pause() {
    this.paused = true
    this.weapon?.pause()
    this.termiteTimer?.pause()
    this.cursorScene.canvas.style.removeProperty("cursor")
  }

  togglePause(force = !this.paused) {
    if (force) this.pause()
    else this.play()
  }

  destroy() {
    this.#cancel?.()
  }
}

/*  */

const weapons = [
  {
    name: "Hammer",
    dir: "./assets/0-hammer/",
    hits: 8,
    dispersion: 4,
    drops: {
      count: 5,
      gravity: 8,
      drop: [5, 15],
      velocityX: [-25, 25],
      velocityY: [0, -40],
    },
    sounds: {
      hit: 8,
    },
  },
  {
    name: "Chain-Saw",
    dir: "./assets/1-chain-saw/",
    cursorOffset: { x: -95, y: -95 },
    fireRate: 50,
    fireLoop: true,
    cursorUpFrames: 2,
    cursorDownFrames: 2,
    cursorDownStates: 8,
    killMargin: 25,
    drops: {
      centered: true,
      count: 5,
      gravity: 4,
      drop: [2, 5],
      velocityX: [-10, 10],
      velocityY: [0, -10],
    },
    sounds: {
      press: { loop: true },
      release: { loop: true },
    },
  },
  {
    name: "Machine Gun",
    dir: "./assets/2-machine-gun/",
    fireRate: 65,
    fireLoop: true,
    hits: 4,
    dispersion: 9,
    cursorDownFrames: 2,
    fireFrames: 14,
    killMargin: 25,
    drops: {
      offset: { x: 130, y: 80 },
      centered: true,
      count: 1,
      frames: 8,
      gravity: 4,
      drop: 1,
      velocityX: [10, 25],
      velocityY: [0, -30],
    },
    sounds: {
      hit: 1,
      drop: 9,
      release: { stereo: false },
    },
  },
  // {
  //   name: "Flame Thrower",
  //   dir: "./assets/3-flame-thrower/",
  //   // fireRate: 65,
  //   // fireLoop: true,
  //   hits: 4,
  //   cursorUpRate: 75,
  //   cursorUpFrames: 2,
  //   cursorDownFrames: 0,
  //   fireFrames: 20,
  // },
  // {
  //   name: "Color Thrower",
  //   dir: "./assets/4-color-thrower/",
  //   // hits: 5,
  //   cursorUpRate: 200,
  //   cursorUpFrames: 4,
  //   cursorDownFrames: 0,
  //   fireFrames: 20,
  // },
  {
    name: "Phaser",
    dir: "./assets/5-phaser/",
    cursorOffset: { x: -63, y: -63 },
    stopOnRelease: false,
    fireRate: 75,
    fireLoop: 2,
    hits: 10,
    cursorDownFrames: 3,
    sounds: {
      press: 1,
    },
  },
  {
    name: "Stamp",
    dir: "./assets/6-stamp/",
    cursorOffset: { x: -48, y: -209 },
    hits: 10,
    sounds: {
      press: 1,
    },
  },
  {
    name: "Termite",
    dir: "./assets/7-termite/",
    cursorOffset: { x: -30, y: -55 },
    cursorUpRate: 150,
    cursorUpFrames: 3,
  },
  {
    name: "Washing",
    dir: "./assets/8-washing/",
    cursorOffset: { x: -63, y: -63 },
    fireRate: 50,
    fireLoop: true,
    hits: 4,
    dispersion: 30,
    cursorDownFrames: 3,
    sounds: {
      press: { loop: true },
    },
  },
]

export const game = new Game({ weapon: 0 })
await game.init()
