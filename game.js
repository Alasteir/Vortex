/**
 * Vertex Run — игровой движок и логика уровня.
 *
 * Назначение файла:
 * - Игровой цикл (update / draw), физика игрока, коллизии с препятствиями.
 * - Генерация уровня (шипы, портал финиша), частицы трения.
 * - Локализация (UA / RU / EN), звук, рекорды, привязка к DOM.
 * - Фоновая музыка с затуханием при финише.
 *
 * Зависимости:
 * - index.html: наличие #gameCanvas, кнопок и экранов (startScreen, deathScreen и т.д.).
 * - Forever_Bound.mp3: файл фоновой музыки в корневой папке проекта.
 * - Стили не требуются для логики, только для отображения.
 *
 * Структура:
 * 1. Локализация (LANG, переключение языка).
 * 2. Canvas и звук.
 * 3. Фоновая музыка с управлением воспроизведением и затуханием.
 * 4. Состояние игры (game) и константы уровня.
 * 5. Построение уровня и сброс игрока.
 * 6. Коллизии (шипы — треугольник, проверка в экранных координатах).
 * 7. Частицы трения при движении по земле.
 * 8. update() — физика, камера, коллизии, финиш.
 * 9. draw() — фон, препятствия, портал, частицы, игрок, HUD.
 * 10. Прыжок, рекорды, экраны смерти/победы.
 * 11. Старт/рестарт, игровой цикл requestAnimationFrame, подписки на события.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Локализация
  // ---------------------------------------------------------------------------
  /** Словари строк интерфейса по кодам языков (UA, RU, EN). Ключи совпадают с data-i18n в разметке. */
  var LANG = {
    UA: {
      subtitle: 'Геометричний раннер',
      controls: 'Натисніть пробіл або торкніться, щоб стрибнути',
      play: 'Грати',
      gameOver: 'Кінець гри',
      levelComplete: 'Рівень пройдено!',
      score: 'Рахунок',
      record: 'Рекорд',
      retry: 'Спробувати знову',
      fullscreen: 'На весь екран',
      brand: 'Неонова аркада Vertex Run.',
      deaths: 'Смертей'
    },
    RU: {
      subtitle: 'Геометрический раннер',
      controls: 'Нажмите пробел или коснитесь, чтобы прыгнуть',
      play: 'Играть',
      gameOver: 'Конец игры',
      levelComplete: 'Уровень пройден!',
      score: 'Счёт',
      record: 'Рекорд',
      retry: 'Попробовать снова',
      fullscreen: 'На весь экран',
      brand: 'Неоновая аркада Vertex Run.',
      deaths: 'Смертей'
    },
    EN: {
      subtitle: 'Geometry runner',
      controls: 'Press space or tap to jump',
      play: 'Play',
      gameOver: 'Game Over',
      levelComplete: 'Level complete!',
      score: 'Score',
      record: 'Record',
      retry: 'Try again',
      fullscreen: 'Full screen',
      brand: 'Neon arcade Vertex Run.',
      deaths: 'Deaths'
    }
  };

  /** Порядок переключения языков кнопкой. */
  var langOrder = ['UA', 'RU', 'EN'];
  /** Текущий индекс языка в langOrder. */
  var currentLangIndex = 0;

  /** Возвращает текущий код языка (например 'UA'). */
  function getLang() {
    return langOrder[currentLangIndex];
  }

  /**
   * Устанавливает язык по индексу: обновляет все [data-i18n], заголовок экрана смерти (если открыт),
   * метку кнопки языка и кнопки «На весь экран», сохраняет выбор в localStorage.
   */
  function setLanguage(index) {
    currentLangIndex = (index + langOrder.length) % langOrder.length;
    var lang = getLang();
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (LANG[lang] && LANG[lang][key]) el.textContent = LANG[lang][key];
    });
    var deathScreen = document.getElementById('deathScreen');
    if (deathScreen && !deathScreen.classList.contains('overlay--hidden')) {
      var titleEl = document.getElementById('deathTitle');
      var complete = deathScreen.getAttribute('data-result') === 'complete';
      if (titleEl) titleEl.textContent = complete && LANG[lang].levelComplete
        ? LANG[lang].levelComplete
        : LANG[lang].gameOver;
    }
    var label = document.getElementById('langLabel');
    if (label) label.textContent = lang;
    var fullscreenLabel = document.getElementById('fullscreenLabel');
    if (fullscreenLabel && LANG[lang].fullscreen) fullscreenLabel.textContent = LANG[lang].fullscreen;
    try { localStorage.setItem('vertexrun_lang', getLang()); } catch (e) {}
  }

  /** Восстанавливает язык из localStorage (ключ vertexrun_lang) и применяет его. */
  function initLang() {
    try {
      var saved = localStorage.getItem('vertexrun_lang');
      var idx = langOrder.indexOf(saved);
      if (idx >= 0) currentLangIndex = idx;
    } catch (e) {}
    setLanguage(currentLangIndex);
  }

  // ---------------------------------------------------------------------------
  // Canvas и звук
  // ---------------------------------------------------------------------------
  /** Холст игры. Размер логического буфера задаётся ниже (W x H). */
  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  /** Логическая ширина и высота игрового поля (соотношение 16:9). */
  var W = 1920;
  var H = 1080;

  /** Включён ли звук. Читается из localStorage (vertexrun_sound) при загрузке. */
  var soundEnabled = true;
  try {
    var saved = localStorage.getItem('vertexrun_sound');
    if (saved === '0') soundEnabled = false;
  } catch (e) {}

  var audioCtx = null;
  /** Возвращает единственный экземпляр AudioContext (создаётся при первом вызове). */
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  /**
   * Воспроизводит короткий тон (если soundEnabled).
   * @param {number} freq - частота в Гц
   * @param {number} duration - длительность в секундах
   * @param {string} [type] - тип осциллятора: 'square', 'sine', 'sawtooth' и т.д.
   */
  function beep(freq, duration, type) {
    if (!soundEnabled) return;
    try {
      var ac = getAudio();
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.connect(g);
      g.connect(ac.destination);
      osc.frequency.value = freq;
      osc.type = type || 'square';
      g.gain.setValueAtTime(0.08, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + duration);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Фоновая музыка
  // ---------------------------------------------------------------------------
  /** Объект HTMLAudioElement для фоновой музыки. */
  var bgMusic = null;
  /** Имя файла фоновой музыки. */
  var MUSIC_FILE = 'Forever_Bound.mp3';
  /** Флаг: идёт ли процесс затухания музыки. */
  var musicFading = false;

  /**
   * Инициализирует объект фоновой музыки: создаёт Audio элемент, настраивает loop и volume.
   * Вызывается при первом старте игры.
   */
  function initBackgroundMusic() {
    if (bgMusic) return;
    try {
      bgMusic = new Audio(MUSIC_FILE);
      bgMusic.loop = true;
      bgMusic.volume = soundEnabled ? 0.4 : 0;
      bgMusic.preload = 'auto';
    } catch (e) {
      console.error('Ошибка загрузки фоновой музыки:', e);
    }
  }

  /**
   * Запускает воспроизведение фоновой музыки с начала.
   * Сбрасывает флаг затухания, устанавливает громкость и запускает трек.
   */
  function playBackgroundMusic() {
    if (!bgMusic) initBackgroundMusic();
    if (!bgMusic) return;
    try {
      if (musicFading) {
        musicFading = false;
        // Очищаем все интервалы затухания (сохраняем ID интервала)
        if (window.fadeIntervalId) {
          clearInterval(window.fadeIntervalId);
          window.fadeIntervalId = null;
        }
      }
      
      bgMusic.currentTime = 0;
      bgMusic.volume = soundEnabled ? 0.4 : 0;
      bgMusic.play().catch(function (e) {
        console.warn('Не удалось воспроизвести фоновую музыку:', e);
      });
    } catch (e) {
      console.error('Ошибка воспроизведения музыки:', e);
    }
  }

  /**
   * Останавливает фоновую музыку (пауза).
   */
  function stopBackgroundMusic() {
    if (!bgMusic) return;
    try {
      bgMusic.pause();
    } catch (e) {}
  }

  /**
   * Плавное затухание фоновой музыки в течение заданного времени.
   * После затухания музыка останавливается.
   * @param {number} duration - длительность затухания в секундах (по умолчанию 2).
 */
function fadeOutBackgroundMusic(duration) {
  if (!bgMusic || musicFading) return;
  duration = duration || 2;
  musicFading = true;
  
  var startVolume = bgMusic.volume;
  var startTime = Date.now();
  
  // ИСПРАВЛЕНИЕ: сохраняем ID интервала глобально для возможности прерывания
  window.fadeIntervalId = setInterval(function () {
    var elapsed = (Date.now() - startTime) / 1000;
    var progress = elapsed / duration;
    
    if (progress >= 1) {
      bgMusic.volume = 0;
      stopBackgroundMusic();
      musicFading = false;
      clearInterval(window.fadeIntervalId);
      window.fadeIntervalId = null;
    } else {
      bgMusic.volume = startVolume * (1 - progress);
    }
  }, 50);
}

  /**
   * Обновляет громкость фоновой музыки в зависимости от состояния soundEnabled.
   * Вызывается при переключении звука кнопкой.
   */
  function updateMusicVolume() {
    if (!bgMusic || musicFading) return;
    try {
      bgMusic.volume = soundEnabled ? 0.4 : 0;
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Состояние игры
  // ---------------------------------------------------------------------------
 /**
 * Центральный объект состояния.
 * running — идёт ли геймплей (после нажатия «Играть»).
 * gravity — направление: 1 вниз, -1 вверх (пока без порталов переворота, оставлено на расширение).
 * (gravityStrength вынесен в JUMP_CONFIG.gravityMultiplier.)
 * player.x — фиксированная экранная координата по X (игрок всегда на одном месте экрана, камера движется).
 * player.y, player.vy — вертикальная позиция и скорость.
 * player.onGround — стоит ли на земле/потолке (для прыжка и частиц).
 * player.rotation — накопленный угол поворота в радианах (+90° за каждый прыжок).
 * speed — смещение камеры за кадр (горизонтальная скорость уровня).
 * cameraX — текущая мировая координата левого края камеры.
 * levelLength — мировая координата конца уровня (для расчёта progress в %).
 * obstacles — массив препятствий { type, x, w, h } (type === 'spike').
 * particles — массив частиц трения { x, y, vx, vy, life, maxLife, size } в мировых координатах.
 * progress — прохождение уровня в процентах (0..100).
 * dead — флаг смерти или победы (показ экрана результата).
 * groundY, ceilingY — мировые Y линии пола и потолка (игрок «примагничен» к ним вне прыжка).
 * portalX — мировая X левого края финишного портала (null если не задан).
 */


  /** Фиксированная позиция игрока от левого края экрана (в пикселях). */
var PLAYER_X = 480;


  var game = {
    running: false,
    gravity: 1,
    gravityDown: 1,
    gravityUp: -1,
    player: {
      x: PLAYER_X,
      y: 0,
      w: 80,
      h: 80,
      vy: 0,
      onGround: true,
      gravity: 1,
      rotation: 0
    },
    speed: 10,
    cameraX: 0,
    levelLength: 0,
    obstacles: [],
    particles: [],
    progress: 0,
    dead: false,
    deaths: 0,
    groundY: 880,
    ceilingY: 200
  };

  try {
    var savedDeaths = parseInt(localStorage.getItem('vertexrun_deaths'), 10);
    if (!isNaN(savedDeaths) && savedDeaths >= 0) game.deaths = savedDeaths;
  } catch (e) {}

  /** Ширина и высота треугольника-шипа (препятствие). */
  var SPIKEW = 55;
  var SPIKEH = 55;

  /** Ширина финишного портала по X. Высота рисуется от ceiling до ground с отступами. */
  var PORTAL_W = 120;
  var PORTAL_H = 400;

  /**
   * Настройки прыжка (тонкая настройка геймплея).
   *
   * initialVelocityUp — модуль вертикальной скорости в момент прыжка (пикселей за кадр).
   *   Итоговая vy = gravity * (-initialVelocityUp). Больше значение — выше и резче прыжок.
   *
   * gravityMultiplier — ускорение падения за кадр: каждым кадром vy += gravity * gravityMultiplier.
   *   Больше значение — тяжелее падение, быстрее приземление. Меньше — более «плавающий» прыжок.
   *
   * rotationRadiansPerJump — на сколько радиан поворачивается игрок за один прыжок (например Math.PI/2 = 90°).
   *
   * velocityCapDown — максимальная скорость падения (положительное число). 0 = без ограничения.
   * velocityCapUp — максимальная скорость вверх при прыжке (положительное число). 0 = без ограничения.
   */
  var JUMP_CONFIG = {
    initialVelocityUp: 20,
    gravityMultiplier: 1.20,
    rotationRadiansPerJump: Math.PI / 2,
    velocityCapDown: 0,
    velocityCapUp: 0
  };

  /**
   * Настройки генерации уровня (передача проекта: менять здесь при балансировке).
   * firstObstacleDistance — расстояние от старта (x игрока) до центра первого шипа.
   * minDistanceBetween / maxDistanceBetween — минимальное и максимальное расстояние между
   *   центрами соседних шипов (между ними выбирается случайное значение).
   * chanceTwoInRowPercent — вероятность в % что после текущего шипа будет добавлен второй
   *   «впритык» (минимальный зазор), затем обычный интервал до следующего.
   * obstacleCount — количество шипов до портала (пары «два подряд» считаются как два элемента).
   */
  var LEVEL_CONFIG = {
    firstObstacleDistance: 2000,
    minDistanceBetween: 350,
    maxDistanceBetween: 600,
    chanceTwoInRowPercent: 30,
    obstacleCount: 60
  };

  /**
   * Строит уровень: заполняет game.obstacles шипами по LEVEL_CONFIG, задаёт game.portalX
   * и game.levelLength. Вызывается при старте и рестарте игры.
   */
  function buildLevel() {
    var list = [];
    var cfg = LEVEL_CONFIG;
    var x = cfg.firstObstacleDistance;
    var minD = cfg.minDistanceBetween;
    var maxD = cfg.maxDistanceBetween;
    var chanceTwo = (cfg.chanceTwoInRowPercent || 0) / 100;
    var n = cfg.obstacleCount;
    for (var i = 0; i < n; i++) {
      list.push({ type: 'spike', x: x, w: SPIKEW, h: SPIKEH });
      if (chanceTwo > 0 && Math.random() < chanceTwo && i + 1 < n) {
        x += SPIKEW + (Math.random() * 1 | 0);
        list.push({ type: 'spike', x: x, w: SPIKEW, h: SPIKEH });
        i++;
      }
      x += minD + Math.random() * (maxD - minD);
    }
    game.obstacles = list;
    game.portalX = x + 300;
    game.levelLength = game.portalX + PORTAL_W + 200;
  }

  

  /**
   * Сбрасывает игрока и общее состояние к началу забега: позиция на земле, нулевая скорость,
   * rotation 0, камера 0, progress 0, dead false, массив частиц очищается.
   */
  function resetPlayer() {
    var p = game.player;
    p.x = PLAYER_X;
    p.y = game.groundY - p.h;
    p.vy = 0;
    p.onGround = true;
    p.gravity = 1;
    p.rotation = 0;
    game.gravity = 1;
    game.cameraX = 0;
    game.progress = 0;
    game.dead = false;
    game.particles = [];
  }

  // ---------------------------------------------------------------------------
  // Коллизии
  // ---------------------------------------------------------------------------
  /** Пересечение двух axis-aligned прямоугольников (для справки; с шипами используется проверка по треугольнику). */
  function rectRect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  /** Проверка: точка (px, py) и точка (cx, cy) лежат по одну сторону от прямой через (ax,ay)-(bx,by). Нужна для pointInTriangle. */
  function sameSide(px, py, ax, ay, bx, by, cx, cy) {
    var cp1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    var cp2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return cp1 * cp2 >= 0;
  }

  /** Находится ли точка (px, py) внутри треугольника (x1,y1), (x2,y2), (x3,y3). Используется метод «по одну сторону» от каждой стороны. */
  function pointInTriangle(px, py, x1, y1, x2, y2, x3, y3) {
    return sameSide(px, py, x1, y1, x2, y2, x3, y3) &&
      sameSide(px, py, x2, y2, x3, y3, x1, y1) &&
      sameSide(px, py, x3, y3, x1, y1, x2, y2);
  }

  /**
   * Проверка столкновения игрока с шипом. Координаты шипа приводятся к экранным (obs.x - cameraX),
   * т.к. игрок рисуется в фиксированной экранной позиции по X. Проверяются шесть точек хитбокса
   * игрока (центр ступни, края ступни, центр тела, края головы) на вхождение в треугольник шипа.
   * @param upsideDown — true если шип на потолке (гравитация перевёрнута).
   * @returns {boolean} true при пересечении (смерть).
   */
  function checkSpike(player, obs, upsideDown) {
    var cam = game.cameraX;
    var sh = obs.h || SPIKEH;
    var sw = obs.w || SPIKEW;
    var gr = game.groundY;
    var ce = game.ceilingY;
    var sx = obs.x - cam;
    var x1 = sx;
    var x2 = sx + sw;
    var x3 = sx + sw * 0.5;
    var y1, y2, y3;
    if (upsideDown) {
      y1 = ce + sh;
      y2 = ce + sh;
      y3 = ce;
    } else {
      y1 = gr - sh;
      y2 = gr - sh;
      y3 = gr;
    }
    var px = player.x;
    var py = player.y;
    var pw = player.w;
    var ph = player.h;
    var cx = px + pw * 0.5;
    var footY = upsideDown ? py : py + ph;
    var headY = upsideDown ? py + ph : py;
    if (pointInTriangle(cx, footY, x1, y1, x2, y2, x3, y3)) return true;
    if (pointInTriangle(px + 4, footY, x1, y1, x2, y2, x3, y3)) return true;
    if (pointInTriangle(px + pw - 4, footY, x1, y1, x2, y2, x3, y3)) return true;
    if (pointInTriangle(cx, py + ph * 0.5, x1, y1, x2, y2, x3, y3)) return true;
    if (pointInTriangle(px + 4, headY, x1, y1, x2, y2, x3, y3)) return true;
    if (pointInTriangle(px + pw - 4, headY, x1, y1, x2, y2, x3, y3)) return true;
    return false;
  }

  /** Пересечение игрока с прямоугольным блоком (оставлено для возможного расширения типов препятствий). */
  function checkBlock(player, obs) {
    var bx = obs.x - game.cameraX;
    var by = game.groundY - (obs.h || 320);
    var bw = 80;
    var bh = obs.h || 320;
    if (player.gravity < 0) {
      by = game.ceilingY;
      bh = obs.h || 320;
    }
    return rectRect(player.x, player.y, player.w, player.h, bx, by, bw, bh);
  }

  /**
 * Добавляет 2 частицы трения в мировых координатах: точка спавна на нижнем (или верхнем 
 * при перевёрнутой гравитации) ребре игрока, случайная горизонтальная и вертикальная 
 * скорость, жизнь и размер задаются случайно.
 * Вызывается из update() каждый кадр, когда игрок на земле и игра идёт.
 */
  function spawnFrictionParticles() {
    var p = game.player;
    var gr = game.groundY;
    var ce = game.ceilingY;
    var g = game.gravity;
    for (var n = 0; n < 2; n++) {
      var px = p.x + game.cameraX + Math.random() * p.w;
      var py = g > 0 ? p.y + p.h : p.y;
      var vx = (Math.random() - 0.5) * 6;
      var vy = g > 0 ? 2 + Math.random() * 5 : -2 - Math.random() * 5;
      game.particles.push({
        x: px, y: py, vx: vx, vy: vy,
        life: 0, maxLife: 18 + Math.random() * 12,
        size: 3 + Math.random() * 4
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Игровой цикл: update
  // ---------------------------------------------------------------------------
  /**
   * Один шаг симуляции. Вызывается из loop() каждый кадр.
   * Порядок: применение гравитации и перемещение по Y; прилипание к земле/потолку;
   * спавн частиц трения при стоянии на земле; обновление и удаление частиц;
   * сдвиг камеры и пересчёт progress; проверка коллизий с шипами (только если экранные
   * X шипа и игрока пересекаются); проверка входа в финишный портал.
   * @param {number} dt — не используется в текущей реализации (физика завязана на фиксированный шаг).
   */
  function update(dt) {
    if (game.dead || !game.running) return;
    var p = game.player;
    var g = game.gravity;
    var ground = game.groundY;
    var ceiling = game.ceilingY;
    var jc = JUMP_CONFIG;
    var gMul = jc.gravityMultiplier;

    p.vy += g * gMul;
    if (jc.velocityCapDown > 0 && g > 0 && p.vy > jc.velocityCapDown) p.vy = jc.velocityCapDown;
    if (jc.velocityCapUp > 0 && g < 0 && p.vy < -jc.velocityCapUp) p.vy = -jc.velocityCapUp;
    p.y += p.vy;

    if (g > 0) {
      if (p.y >= ground - p.h) {
        p.y = ground - p.h;
        p.vy = 0;
        p.onGround = true;
      } else {
        p.onGround = false;
      }
    } else {
      if (p.y <= ceiling) {
        p.y = ceiling;
        p.vy = 0;
        p.onGround = true;
      } else {
        p.onGround = false;
      }
    }

    if (p.onGround && game.running) {
      spawnFrictionParticles();
    }

    var part = game.particles;
    for (var i = part.length - 1; i >= 0; i--) {
      part[i].x += part[i].vx;
      part[i].y += part[i].vy;
      part[i].life += 1;
      if (part[i].life >= part[i].maxLife) part.splice(i, 1);
    }

    game.cameraX += game.speed;
    game.progress = (game.cameraX / game.levelLength) * 100;

    var cam = game.cameraX;
    var playerScreenLeft = p.x;
    var playerScreenRight = p.x + p.w;
    for (var i = 0; i < game.obstacles.length; i++) {
      var obs = game.obstacles[i];
      if (obs.type !== 'spike') continue;
      var sw = obs.w || SPIKEW;
      var spikeScreenLeft = obs.x - cam;
      var spikeScreenRight = obs.x - cam + sw;
      if (spikeScreenRight <= playerScreenLeft || spikeScreenLeft >= playerScreenRight) continue;

      var spikeUp = (game.gravity > 0);
      if (spikeUp && p.y + p.h > ground - (obs.h || SPIKEH)) {
        if (checkSpike(p, obs, false)) {
          game.deaths += 1;
          try { localStorage.setItem('vertexrun_deaths', String(game.deaths)); } catch (e) {}
          game.dead = true;
          beep(150, 0.3, 'sawtooth');
          fadeOutBackgroundMusic(2);
          showDeath();
          return;
        }
      }
      if (!spikeUp && p.y < ceiling + (obs.h || SPIKEH)) {
        if (checkSpike(p, obs, true)) {
          game.deaths += 1;
          try { localStorage.setItem('vertexrun_deaths', String(game.deaths)); } catch (e) {}
          game.dead = true;
          beep(150, 0.3, 'sawtooth');
          fadeOutBackgroundMusic(2);
          showDeath();
          return;
        }
      }
    }

    if (game.portalX != null && !game.dead) {
      var portScreenLeft = game.portalX - cam;
      var portScreenRight = portScreenLeft + PORTAL_W;
      var playerScreenLeft = p.x;
      var playerScreenRight = p.x + p.w;
      if (portScreenRight > playerScreenLeft && portScreenLeft < playerScreenRight) {
        game.progress = 100;
        game.dead = true;
        fadeOutBackgroundMusic(2);
        showDeath();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Отрисовка: draw
  // ---------------------------------------------------------------------------
  /**
   * Отрисовка кадра: фон (слои с параллаксом), пол и потолок, шипы в экранных координатах,
   * финишный портал (если в зоне видимости), частицы трения, игрок (с поворотом и градиентом),
   * процент прохождения и обновление счётчиков в DOM.
   */
  function draw() {
    var c = ctx;
    c.fillStyle = '#0d0a12';
    c.fillRect(0, 0, W, H);

    var cam = game.cameraX;
    var gr = game.groundY;
    var ce = game.ceilingY;

    for (var bg = 0; bg < 3; bg++) {
      var off = (cam * (0.3 + bg * 0.2)) % (W + 400);
      c.fillStyle = bg === 0 ? '#15101c' : bg === 1 ? '#1e1228' : '#2a1838';
      c.fillRect(-off, 0, W + 800, H);
    }

    c.fillStyle = '#2a1e38';
    c.fillRect(0, ce - 4, W + 200, 8);
    c.fillRect(0, gr, W + 200, H - gr + 4);
    c.fillStyle = '#3a2848';
    c.fillRect(0, ce, W + 200, 4);
    c.fillRect(0, gr, W + 200, 4);

    for (var i = 0; i < game.obstacles.length; i++) {
      var o = game.obstacles[i];
      var screenX = o.x - cam;
      if (screenX > W + 100 || screenX < -100) continue;
      if (o.type !== 'spike') continue;
      var sh = o.h || SPIKEH;
      var sw = o.w || SPIKEW;
      var sy = game.gravity > 0 ? gr - sh : ce;
      c.fillStyle = '#ffb7c5';
      c.beginPath();
      if (game.gravity > 0) {
        c.moveTo(screenX, sy + sh);
        c.lineTo(screenX + sw, sy + sh);
        c.lineTo(screenX + sw * 0.5, sy);
      } else {
        c.moveTo(screenX, sy);
        c.lineTo(screenX + sw, sy);
        c.lineTo(screenX + sw * 0.5, sy + sh);
      }
      c.closePath();
      c.fill();
      c.strokeStyle = '#e8b4b8';
      c.lineWidth = 2;
      c.stroke();
    }

    if (game.portalX != null) {
      var portScreenX = game.portalX - cam;
      if (portScreenX > -150 && portScreenX < W + 50) {
        var portTop = ce + 40;
        var portBottom = gr - 40;
        c.fillStyle = 'rgba(255, 183, 197, 0.25)';
        c.fillRect(portScreenX, portTop, PORTAL_W, portBottom - portTop);
        c.strokeStyle = '#ffb7c5';
        c.lineWidth = 4;
        c.strokeRect(portScreenX, portTop, PORTAL_W, portBottom - portTop);
        c.fillStyle = 'rgba(255, 255, 255, 0.9)';
        c.font = 'bold 24px sans-serif';
        c.textAlign = 'center';
        c.fillText('FINISH', portScreenX + PORTAL_W / 2, (portTop + portBottom) / 2 + 8);
        c.textAlign = 'left';
      }
    }

    var part = game.particles;
    for (var i = 0; i < part.length; i++) {
      var px = part[i].x - cam;
      var py = part[i].y;
      var t = part[i].maxLife > 0 ? part[i].life / part[i].maxLife : 1;
      var alpha = 1 - t;
      c.fillStyle = 'rgba(255, 210, 100, ' + alpha + ')';
      c.beginPath();
      c.arc(px, py, part[i].size, 0, Math.PI * 2);
      c.fill();
    }

    var p = game.player;
    c.save();
    c.translate(p.x + p.w / 2, p.y + p.h / 2);
    c.rotate(p.rotation + (p.gravity < 0 ? Math.PI : 0));
    c.translate(-p.w / 2, -p.h / 2);
    var r = 8;
    var w = p.w;
    var h = p.h;
    c.beginPath();
    c.moveTo(r, 0);
    c.lineTo(w - r, 0);
    c.quadraticCurveTo(w, 0, w, r);
    c.lineTo(w, h - r);
    c.quadraticCurveTo(w, h, w - r, h);
    c.lineTo(r, h);
    c.quadraticCurveTo(0, h, 0, h - r);
    c.lineTo(0, r);
    c.quadraticCurveTo(0, 0, r, 0);
    c.closePath();
    var bodyGrad = c.createLinearGradient(0, 0, w, h);
    bodyGrad.addColorStop(0, '#ffd54f');
    bodyGrad.addColorStop(0.4, '#ffb74d');
    bodyGrad.addColorStop(1, '#e65100');
    c.fillStyle = bodyGrad;
    c.fill();
    c.shadowColor = '#4ecdc4';
    c.shadowBlur = 10;
    c.strokeStyle = '#4ecdc4';
    c.lineWidth = 3;
    c.stroke();
    c.shadowBlur = 0;
    var eyeSize = 14;
    var eyeY = 18;
    var eyeLeft = 20;
    var eyeRight = w - 20 - eyeSize;
    c.fillStyle = '#4ecdc4';
    c.strokeStyle = '#1a1a2a';
    c.lineWidth = 2;
    c.fillRect(eyeLeft, eyeY, eyeSize, eyeSize);
    c.strokeRect(eyeLeft, eyeY, eyeSize, eyeSize);
    c.fillRect(eyeRight, eyeY, eyeSize, eyeSize);
    c.strokeRect(eyeRight, eyeY, eyeSize, eyeSize);
    var mouthW = 28;
    var mouthH = 10;
    var mouthX = (w - mouthW) / 2;
    var mouthY = h - 24;
    c.fillRect(mouthX, mouthY, mouthW, mouthH);
    c.strokeRect(mouthX, mouthY, mouthW, mouthH);
    c.restore();

    c.fillStyle = 'rgba(240, 232, 242, 0.95)';
    c.font = 'bold 36px sans-serif';
    c.textAlign = 'right';
    c.fillText(Math.min(100, Math.floor(game.progress)) + '%', W - 24, 56);
    c.textAlign = 'left';
    updateScoreDisplay();
    updateDeathsDisplay();
    var tapHint = document.getElementById('tapHint');
    if (tapHint) tapHint.style.visibility = game.running && !game.dead ? 'visible' : 'hidden';
  }

  /**
   * Прыжок: задаётся вертикальная скорость из JUMP_CONFIG.initialVelocityUp (с учётом направления gravity),
   * снимается флаг onGround, к rotation добавляется JUMP_CONFIG.rotationRadiansPerJump, воспроизводится звук.
   * Вызывается по клику/пробелу/тапу.
   */
  function jump() {
    if (!game.running || game.dead) return;
    var p = game.player;
    if (!p.onGround) return;
    var jc = JUMP_CONFIG;
    p.vy = game.gravity * -jc.initialVelocityUp;
    p.onGround = false;
    p.rotation += jc.rotationRadiansPerJump;
    beep(520, 0.08, 'square');
  }

  // ---------------------------------------------------------------------------
  // Рекорды и экраны результата
  // ---------------------------------------------------------------------------
  /** Читает сохранённый рекорд (процент прохождения) из localStorage. Ключ: vertexrun_record. */
  function getRecord() {
    try {
      var r = parseInt(localStorage.getItem('vertexrun_record'), 10);
      return isNaN(r) ? 0 : Math.min(100, r);
    } catch (e) { return 0; }
  }

  /** Записывает рекорд, если value больше текущего, и обновляет отображение во всех блоках (HUD и оверлеи). */
  function setRecord(value) {
    var v = Math.min(100, Math.floor(value));
    try {
      var prev = getRecord();
      if (v > prev) localStorage.setItem('vertexrun_record', String(v));
      updateRecordDisplay();
    } catch (e) {}
  }

  /** Синхронизирует значение рекорда с DOM: recordScore, overlayBest, overlayBestDeath. */
  function updateRecordDisplay() {
    var r = getRecord();
    var el = document.getElementById('recordScore');
    if (el) el.textContent = r;
    var ob = document.getElementById('overlayBest');
    if (ob) ob.textContent = r;
    var obd = document.getElementById('overlayBestDeath');
    if (obd) obd.textContent = r;
  }

  /** Выводит текущий прогресс (0..100) в currentScore. */
  function updateScoreDisplay() {
    var val = game.running ? Math.min(100, Math.floor(game.progress)) : (game.dead ? Math.min(100, Math.floor(game.progress)) : 0);
    var el = document.getElementById('currentScore');
    if (el) el.textContent = val;
  }

  /** Синхронизирует количество смертей за забег с DOM: deathsCount, overlayDeaths, finalDeaths. */
  function updateDeathsDisplay() {
    var d = game.deaths;
    var el = document.getElementById('deathsCount');
    if (el) el.textContent = d;
    var ov = document.getElementById('overlayDeaths');
    if (ov) ov.textContent = d;
    var fin = document.getElementById('finalDeaths');
    if (fin) fin.textContent = d;
  }

  /**
   * Показывает экран результата: подставляет итоговый процент, обновляет рекорд, заголовок
   * («Конец игры» или «Уровень пройдено» при progress >= 100), рекорд в карточке и снимает класс overlay--hidden.
   */
  function showDeath() {
    var scoreEl = document.getElementById('finalScore');
    var screen = document.getElementById('deathScreen');
    var titleEl = document.getElementById('deathTitle');
    var progress = Math.min(100, Math.floor(game.progress));
    scoreEl.textContent = progress;
    setRecord(progress);
    updateScoreDisplay();
    updateDeathsDisplay();
    var complete = progress >= 100;
    screen.setAttribute('data-result', complete ? 'complete' : 'death');
    var lang = getLang();
    if (titleEl) titleEl.textContent = complete && LANG[lang].levelComplete
      ? LANG[lang].levelComplete
      : LANG[lang].gameOver;
    document.getElementById('overlayBestDeath').textContent = getRecord();
    screen.classList.remove('overlay--hidden');
  }

  /** Скрывает экран смерти (добавляет overlay--hidden). */
  function hideDeath() {
    var el = document.getElementById('deathScreen');
    if (el) el.classList.add('overlay--hidden');
  }

  /** Запуск игры: скрывает стартовый оверлей, скрывает экран смерти, перестраивает уровень, сбрасывает игрока, game.running = true, запускает музыку. */
  function startGame() {
    var startEl = document.getElementById('startScreen');
    if (startEl) startEl.classList.add('overlay--hidden');
    hideDeath();
    buildLevel();
    resetPlayer();
    game.running = true;
    playBackgroundMusic();
  }

  /** Рестарт после смерти/победы: скрывает экран результата, заново строит уровень, сбрасывает игрока, game.running = true, запускает музыку. */
  function restartGame() {
    hideDeath();
    buildLevel();
    resetPlayer();
    game.running = true;
    playBackgroundMusic();
  }

  /** Время предыдущего кадра (для расчёта dt). */
  var lastTime = 0;
  /**
   * Главный цикл анимации: ограничивает dt сверху (защита от долгих пауз), вызывает update(dt) и draw(),
   * затем requestAnimationFrame(loop). Запускается один раз в конце инициализации.
   */
  function loop(now) {
    var dt = Math.min((now - lastTime) / 16, 4);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------
  // Привязка к DOM и событиям
  // ---------------------------------------------------------------------------
  document.getElementById('btnStart').addEventListener('click', function () {
    startGame();
  });

  document.getElementById('btnRestart').addEventListener('click', function () {
    restartGame();
  });

  /** Переключение полноэкранного режима для элемента .game-frame. */
  function toggleFullscreen() {
    var frame = document.querySelector('.game-frame');
    if (!frame) return;
    if (!document.fullscreenElement) {
      frame.requestFullscreen().catch(function () {});
      frame.classList.add('fullscreen-active');
    } else {
      document.exitFullscreen();
      frame.classList.remove('fullscreen-active');
    }
  }

  document.getElementById('btnFullscreen').addEventListener('click', toggleFullscreen);

  document.getElementById('btnSound').addEventListener('click', function () {
    soundEnabled = !soundEnabled;
    document.getElementById('btnSound').classList.toggle('sound-off', !soundEnabled);
    try { localStorage.setItem('vertexrun_sound', soundEnabled ? '1' : '0'); } catch (e) {}
    updateMusicVolume();
    if (soundEnabled) beep(400, 0.05, 'sine');
  });

  document.getElementById('btnSound').classList.toggle('sound-off', !soundEnabled);

  document.getElementById('btnLang').addEventListener('click', function () {
    currentLangIndex = (currentLangIndex + 1) % langOrder.length;
    setLanguage(currentLangIndex);
  });

  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space') {
      e.preventDefault();
      jump();
    }
  });

  canvas.addEventListener('click', function (e) {
    e.preventDefault();
    jump();
  });

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    jump();
  }, { passive: false });

  document.addEventListener('fullscreenchange', function () {
    var frame = document.querySelector('.game-frame');
    if (frame) frame.classList.toggle('fullscreen-active', !!document.fullscreenElement);
  });

  // ---------------------------------------------------------------------------
  // Инициализация при загрузке страницы
  // ---------------------------------------------------------------------------
  initLang();
  updateRecordDisplay();
  updateDeathsDisplay();
  buildLevel();
  resetPlayer();
  game.running = false;
  initBackgroundMusic();
  requestAnimationFrame(loop);
})();