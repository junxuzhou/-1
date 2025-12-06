// app.js - minimal client-side NetCDF ERA5 visualizer
// Uses netcdfjs, d3-contour and Leaflet + proj4leaflet

let reader = null;
let dataset = null;
let map, canvasLayer;
let currentGrid = null;

// Path to JSON data file (adjust if needed)
const dataFile = './data/temperature.json';

function initMap() {
  try {
    // default: simple EPSG:3857 map for demonstration
    map = L.map('map', { worldCopyJump: true }).setView([35, 105], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12 }).addTo(map);

    if (L.canvasLayer) {
      canvasLayer = L.canvasLayer().delegate({
        onDrawLayer: function(info) {
          // placeholder
        }
      }).addTo(map);
    }
    setStatus('地图初始化成功');
  } catch (e) {
    console.error('initMap error', e);
    setStatus('地图初始化失败：' + e.message);
    // ensure there's a visible fallback rectangle so user sees something
    const el = document.getElementById('map');
    if (el) {
      el.style.background = '#eee';
      el.innerHTML = '<div style="padding:20px;color:#333">地图初始化失败，请查看控制台 (F12) 以获取详情。</div>';
    }
  }
}

function setStatus(msg) {
  try { const s = document.getElementById('status'); if (s) s.textContent = msg; } catch(e){}
}

function detectVars(nc) {
  // netcdfjs provides .variables array with {name, size, type}
  const vars = nc.variables.map(v => v.name);
  return vars;
}

// Detect level coordinates for variables. Returns map varName -> {levels: [vals], levelDimName}
function detectVarLevels(nc) {
  const out = {};
  nc.variables.forEach(v => {
    const name = v.name;
    // find any dim name that looks like a level
    const levelDim = v.dimensions.find(d => /level|plev|isobaric|lev/i.test(d));
    if (levelDim) {
      // try to find coordinate variable with that dim name
      const coord = nc.variables.find(x => x.name.toLowerCase() === levelDim.toLowerCase() || (x.dimensions && x.dimensions.length===1 && x.name.toLowerCase().indexOf('level')!==-1));
      if (coord) {
        try { out[name] = { levels: Array.from(nc.getDataVariable(coord.name)), levelDimName: coord.name }; } catch(e) { out[name] = { levels: null, levelDimName: levelDim }; }
      } else {
        out[name] = { levels: null, levelDimName: levelDim };
      }
    } else {
      out[name] = { levels: null, levelDimName: null };
    }
  });
  return out;
}

// Choose a best variable name from detected variables (simple heuristic)
function chooseBestVar(vars) {
  const prefs = ['t2m','t','air_temperature','2t','temperature','z','gh','geopotential','z500','z_500','msl','mean_sea_level_pressure','u','v'];
  const lower = vars.map(v=>v.toLowerCase());
  for (const p of prefs) {
    const idx = lower.findIndex(x => x === p || x.indexOf(p) !== -1);
    if (idx !== -1) return vars[idx];
  }
  return vars[0];
}

function readArray(nc, varName) {
  const v = nc.variables.find(x => x.name === varName);
  if (!v) return null;
  // v.readSlice not always available; netcdfjs gives data via getDataVariable
  try {
    return nc.getDataVariable(varName);
  } catch (e) {
    console.error('getDataVariable failed', e);
    // fallback: try reading as typed array manually
    return null;
  }
}

function onFile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const readerFile = new FileReader();
  readerFile.onload = function(e) {
    try {
      // Support both NetCDFReader (some builds) and bundled `netcdfjs` global
      const bytes = new Uint8Array(e.target.result);
      if (typeof NetCDFReader !== 'undefined') {
        reader = new NetCDFReader(bytes);
      } else if (typeof netcdfjs !== 'undefined') {
        // netcdfjs UMD exposes the class as `netcdfjs`
        reader = new netcdfjs(bytes);
      } else {
        throw new Error('NetCDF reader library 未加载 (NetCDFReader 或 netcdfjs 未定义)');
      }
      dataset = reader;
      const vars = detectVars(reader);
          const varLevels = detectVarLevels(reader);
      const sel = document.getElementById('varSelect');
      sel.innerHTML = '';
      vars.forEach(v => {
        const opt = document.createElement('option'); opt.value = v; opt.text = v; sel.appendChild(opt);
      });
          // populate composite-specific selectors
          function fillSelect(id, options, addEmpty) {
            const el = document.getElementById(id); if (!el) return;
            el.innerHTML = addEmpty? '<option value="">--</option>':'';
            options.forEach(o=>{ const opt=document.createElement('option'); opt.value=o; opt.text=o; el.appendChild(opt); });
          }
          fillSelect('geo500Var', vars, true);
          fillSelect('temp500Var', vars, true);
          fillSelect('u850Var', vars, true);
          fillSelect('v850Var', vars, true);
          // populate level selects if available
          function fillLevelSelect(varName, levelSelectId) {
            const selEl = document.getElementById(levelSelectId); if (!selEl) return;
            selEl.innerHTML = '<option value="">--</option>';
            if (!varName) return;
            const info = varLevels[varName];
            if (info && info.levels && info.levels.length) {
              info.levels.forEach(l=>{ const o=document.createElement('option'); o.value = l; o.text = l; selEl.appendChild(o); });
            }
          }
          // when variable selectors change, update level selects
          ['geo500Var','temp500Var','u850Var','v850Var'].forEach(id=>{
            const el = document.getElementById(id); if (!el) return;
            el.addEventListener('change', ()=>{
              if (id==='geo500Var') fillLevelSelect(el.value, 'geo500Level');
              if (id==='temp500Var') fillLevelSelect(el.value, 'temp500Level');
              if (id==='u850Var' || id==='v850Var') fillLevelSelect(el.value, 'wind850Level');
            });
          });
      // 变量检测完成，尝试自动选择并绘制首选变量
      console.log('变量检测完成：' + vars.join(', '));
      if (vars.length > 0) {
        const best = chooseBestVar(vars);
        sel.value = best;
        try {
          const grid = gridFromVar(best);
          if (grid) {
            currentGrid = grid;
            drawIsobars(grid);
            console.log('已自动绘制变量：' + best);
          } else {
            console.warn('无法为变量构建网格：' + best);
          }
        } catch (e) { console.warn('自动绘图失败', e); }
      }
    } catch (err) {
      alert('打开 NetCDF 失败: ' + err);
      console.error(err);
    }
  };
  readerFile.readAsArrayBuffer(file);
}

function gridFromVar(varName) {
  // Heuristic: find lon/lat coords in dataset variables/attributes
  const nc = dataset;
  const vars = nc.variables.map(v => v.name);
  let lonName = vars.find(n => /lon/i.test(n)) || 'longitude';
  let latName = vars.find(n => /lat/i.test(n)) || 'latitude';
  // read lon/lat
  const lons = nc.getDataVariable(lonName);
  const lats = nc.getDataVariable(latName);
  const field = nc.getDataVariable(varName);
  // field shape may be [time?][level?][lat][lon] - pick last two dims
  // netcdfjs flattens arrays, but NetCDFReader provides dimensions property
  const v = nc.variables.find(x => x.name === varName);
  const dims = v.dimensions; // array of dim names
  // find lat/lon dims index
  const latDim = dims.find(d => /lat/i.test(d)) || dims[dims.length-2];
  const lonDim = dims.find(d => /lon/i.test(d)) || dims[dims.length-1];
  // assume regular grid
  // build 2D arrays using lats/lons vectors if provided
  let lon2d, lat2d, values2d;
  if (Array.isArray(lons) && Array.isArray(lats)) {
    const nx = lons.length, ny = lats.length;
    lon2d = new Array(ny).fill(0).map((_,j) => new Array(nx).fill(0).map((_,i)=>lons[i]));
    lat2d = new Array(ny).fill(0).map((_,j) => new Array(nx).fill(0).map((_,i)=>lats[j]));
    // now reshape field into [ny][nx]
    values2d = new Array(ny).fill(0).map(()=>new Array(nx));
    // field may include extra dims at start (time/level) - try to find last nx*ny values
    const flat = Array.from(field);
    if (flat.length >= nx*ny) {
      const start = flat.length - nx*ny;
      for (let j=0;j<ny;j++) for (let i=0;i<nx;i++) values2d[j][i]=flat[start + j*nx + i];
    } else {
      // fallback: fill NaN
      for (let j=0;j<ny;j++) for (let i=0;i<nx;i++) values2d[j][i]=NaN;
    }
    return {lon:lon2d, lat:lat2d, values:values2d};
  }
  return null;
}

// Helper: find variable that matches any of preferred names and has the requested level (hPa)
function findVarWithLevel(nc, candidates, targetLevel) {
  const vars = nc.variables.map(v => v.name);
  const lower = vars.map(v=>v.toLowerCase());
  for (const cand of candidates) {
    // exact or substring match
    const idx = lower.findIndex(n => n === cand || n.indexOf(cand) !== -1);
    if (idx === -1) continue;
    const varName = vars[idx];
    const v = nc.variables.find(x=>x.name===varName);
    // find a dimension that represents level
    const dimNames = v.dimensions.map(d=>d.toLowerCase());
    const levelDim = dimNames.find(d => d.indexOf('level')!==-1 || d.indexOf('plev')!==-1 || d.indexOf('isobaric')!==-1 || d.indexOf('lev')!==-1);
    if (!levelDim) {
      // if no level dim, accept variable if targetLevel is null
      if (!targetLevel) return {varName: varName, levelIndex: null};
      continue;
    }
    // try to get coordinate variable values for that dim
    const dimIndex = v.dimensions.findIndex(d => d.toLowerCase()===levelDim);
    let levelValues = null;
    const coordVar = nc.variables.find(x => x.name.toLowerCase()===levelDim || x.name.toLowerCase().indexOf('level')!==-1 && x.dimensions.length===1);
    if (coordVar) {
      levelValues = Array.from(nc.getDataVariable(coordVar.name));
    } else {
      // fallback: try variable dimension length
      levelValues = null;
    }
    if (levelValues) {
      // look for exact or nearest match to targetLevel
      const idxMatch = levelValues.findIndex(vv => Math.abs(Number(vv) - Number(targetLevel)) < 1e-6 || Math.abs(Number(vv) - Number(targetLevel)) < 1);
      if (idxMatch !== -1) return {varName: varName, levelIndex: idxMatch};
    }
  }
  return null;
}

// Extract 2D grid for variable at a given level index (or the only 2D slice)
function extract2DAtLevel(nc, varName, levelIndex) {
  const v = nc.variables.find(x=>x.name===varName);
  if (!v) return null;
  const lons = nc.getDataVariable( nc.variables.find(x=>/lon/i.test(x.name)).name );
  const lats = nc.getDataVariable( nc.variables.find(x=>/lat/i.test(x.name)).name );
  const field = Array.from(nc.getDataVariable(varName));
  const nx = lons.length, ny = lats.length;
  // find last two dims positions
  const dims = v.dimensions;
  // assume last two dims correspond to lat,lon
  const size = nx*ny;
  let flat = field;
  if (flat.length >= size) {
    const start = flat.length - size;
    const values2d = new Array(ny).fill(0).map(()=>new Array(nx));
    for (let j=0;j<ny;j++) for (let i=0;i<nx;i++) values2d[j][i] = flat[start + j*nx + i];
    const lon2d = new Array(ny).fill(0).map((_,j)=> new Array(nx).fill(0).map((_,i)=>lons[i]));
    const lat2d = new Array(ny).fill(0).map((_,j)=> new Array(nx).fill(0).map((_,i)=>lats[j]));
    return {lon: lon2d, lat: lat2d, values: values2d};
  }
  return null;
}

// Draw composite: 500hPa geopotential contours + 850hPa wind vectors
function drawComposite(geoGrid, windUGrid, windVGrid) {
  if (!geoGrid) { alert('找不到 500 hPa 高度场'); return; }
  // draw geopotential contours (reuse drawIsobars logic but for the provided grid)
  drawIsobars(geoGrid);
  // draw wind vectors as SVG arrows on top
  if (!windUGrid || !windVGrid) { console.warn('风场数据不完整，跳过风矢绘制'); return; }
  const nx = windUGrid.lon[0].length, ny = windUGrid.lat.length;
  // sample spacing to avoid clutter
  const step = Math.max(1, Math.floor(Math.min(nx,ny)/20));
  const overlay = document.querySelector('.leaflet-overlay-pane') || map.getPanes().overlayPane;
  const svg = document.getElementById('nc-svg') || (()=>{ const ns='http://www.w3.org/2000/svg'; const s=document.createElementNS(ns,'svg'); s.id='nc-svg'; overlay.appendChild(s); return s; })();
  const ns='http://www.w3.org/2000/svg';
  // draw arrows
  for (let j=0;j<ny;j+=step) {
    for (let i=0;i<nx;i+=step) {
      const lon = windUGrid.lon[j][i], lat = windUGrid.lat[j][i];
      const u = windUGrid.values[j][i], v = windVGrid.values[j][i];
      if (!isFinite(u) || !isFinite(v)) continue;
      const startPt = map.latLngToLayerPoint([lat, lon]);
      // scale vector for display (heuristic)
      const scale = 0.8;
      const endPt = map.latLngToLayerPoint([lat + ( -v * scale / 100 ), lon + ( u * scale / (111000*Math.cos(lat*Math.PI/180)) )]);
      const line = document.createElementNS(ns,'line');
      line.setAttribute('x1', startPt.x); line.setAttribute('y1', startPt.y);
      line.setAttribute('x2', endPt.x); line.setAttribute('y2', endPt.y);
      line.setAttribute('stroke', 'blue'); line.setAttribute('stroke-width','1.2');
      svg.appendChild(line);
    }
  }
}

function clearOverlaySvg() {
  const old = document.getElementById('nc-svg'); if (old) old.remove();
}

function drawTemperatureShading(tempGrid) {
  if (!tempGrid) return;
  // remove existing svg so drawIsobars will recreate it
  clearOverlaySvg();
  const nx = tempGrid.lon[0].length, ny = tempGrid.lat.length;
  const values = new Float32Array(nx*ny);
  let min = Infinity, max = -Infinity;
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++) { const v=tempGrid.values[j][i]; values[j*nx+i]=v; if (isFinite(v)){ min=Math.min(min,v); max=Math.max(max,v);} }
  if (!isFinite(min) || !isFinite(max)) return;
  // thresholds
  const nsteps = 12;
  const thresholds = d3.range(nsteps).map(i => min + (i+1)*(max-min)/(nsteps+1));
  const contours = d3.contours().size([nx,ny]).thresholds(thresholds)(values);
  const overlay = document.querySelector('.leaflet-overlay-pane') || map.getPanes().overlayPane;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg'); svg.id='nc-svg'; svg.style.position='absolute'; overlay.appendChild(svg);
  const color = d3.scaleSequential(d3.interpolateRdYlBu).domain([max,min]);
  contours.forEach(cont=>{
    const polygons = contourToPolygons(cont, tempGrid);
    polygons.forEach(poly=>{
      const pathEl = document.createElementNS(svgNS,'path');
      const d = geoToPathD(poly);
      pathEl.setAttribute('d', d);
      pathEl.setAttribute('stroke','none');
      pathEl.setAttribute('fill', color(cont.value));
      pathEl.setAttribute('fill-opacity','0.7');
      svg.appendChild(pathEl);
    })
  });
}

function drawWindBarbs(uGrid, vGrid) {
  if (!uGrid || !vGrid) return;
  // remove any existing barb group but keep nc-svg for contours
  let svg = document.getElementById('nc-svg');
  if (!svg) {
    const overlay = document.querySelector('.leaflet-overlay-pane') || map.getPanes().overlayPane;
    const svgNS = 'http://www.w3.org/2000/svg'; svg = document.createElementNS(svgNS,'svg'); svg.id='nc-svg'; svg.style.position='absolute'; overlay.appendChild(svg);
  }
  // create a group for barbs
  const ns='http://www.w3.org/2000/svg';
  let grp = document.getElementById('barb-group'); if (grp) grp.remove();
  grp = document.createElementNS(ns,'g'); grp.id='barb-group'; svg.appendChild(grp);
  const nx = uGrid.lon[0].length, ny = uGrid.lat.length;
  const step = Math.max(1, Math.floor(Math.min(nx,ny)/20));
  const barbScale = 8; // pixels per 10 m/s approx
  for (let j=0;j<ny;j+=step) for (let i=0;i<nx;i+=step) {
    const lon = uGrid.lon[j][i], lat = uGrid.lat[j][i];
    const u = uGrid.values[j][i], v = vGrid.values[j][i];
    if (!isFinite(u) || !isFinite(v)) continue;
    const speed = Math.sqrt(u*u+v*v); // m/s
    // position
    const p = map.latLngToLayerPoint([lat, lon]);
    // shaft length scaled
    const len = 10; // base pixel length
    // direction: wind vector points to where wind is blowing (u east, v north) -> meteorological barb drawn pointing to where wind comes from; but we draw simple shaft in wind direction
    const angle = Math.atan2(-v, u); // rotate so that arrow is oriented
    const x2 = p.x + len*Math.cos(angle);
    const y2 = p.y + len*Math.sin(angle);
    // draw shaft
    const line = document.createElementNS(ns,'line');
    line.setAttribute('x1', p.x); line.setAttribute('y1', p.y);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke','black'); line.setAttribute('stroke-width','1'); grp.appendChild(line);
    // draw simplified barbs perpendicular to shaft to indicate speed
    // convert to knots
    const kt = speed * 1.943844;
    let remain = Math.round(kt);
    let xbase = x2, ybase = y2;
    let barbPos = 0;
    // pennant (50 kt)
    while (remain >= 50) {
      // draw triangle pennant
      const p1x = xbase - barbPos*Math.cos(angle), p1y = ybase - barbPos*Math.sin(angle);
      const p2x = p1x - 6*Math.cos(angle+Math.PI/2), p2y = p1y - 6*Math.sin(angle+Math.PI/2);
      const p3x = p1x - 6*Math.cos(angle)*0.6, p3y = p1y - 6*Math.sin(angle)*0.6;
      const path = document.createElementNS(ns,'path');
      path.setAttribute('d', `M ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y} Z`);
      path.setAttribute('fill','black'); grp.appendChild(path);
      remain -= 50; barbPos += 6;
    }
    // full barbs = 10 kt
    while (remain >= 10) {
      const bx = xbase - barbPos*Math.cos(angle), by = ybase - barbPos*Math.sin(angle);
      const tx = bx - 6*Math.cos(angle+Math.PI/2), ty = by - 6*Math.sin(angle+Math.PI/2);
      const tline = document.createElementNS(ns,'line');
      tline.setAttribute('x1', bx); tline.setAttribute('y1', by);
      tline.setAttribute('x2', tx); tline.setAttribute('y2', ty);
      tline.setAttribute('stroke','black'); tline.setAttribute('stroke-width','1'); grp.appendChild(tline);
      remain -= 10; barbPos += 6;
    }
    // half barb = 5 kt
    if (remain >= 5) {
      const bx = xbase - barbPos*Math.cos(angle), by = ybase - barbPos*Math.sin(angle);
      const tx = bx - 3*Math.cos(angle+Math.PI/2), ty = by - 3*Math.sin(angle+Math.PI/2);
      const tline = document.createElementNS(ns,'line');
      tline.setAttribute('x1', bx); tline.setAttribute('y1', by);
      tline.setAttribute('x2', tx); tline.setAttribute('y2', ty);
      tline.setAttribute('stroke','black'); tline.setAttribute('stroke-width','1'); grp.appendChild(tline);
    }
  }
}

function drawIsobars(grid) {
  // grid: {lon,lat,values} arrays
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  // project lon/lat to pixel using map.latLngToContainerPoint
  const ny = grid.lat.length, nx = grid.lon[0].length;
  // create value array for d3-contour (row-major)
  const values = new Float32Array(nx*ny);
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++) values[j*nx+i] = grid.values[j][i] || NaN;
  const contours = d3.contours().size([nx,ny]).thresholds(12)(values);
  // draw contours on map overlay
  const overlay = document.querySelector('.leaflet-overlay-pane') || map.getPanes().overlayPane;
  const svgNS = 'http://www.w3.org/2000/svg';
  // remove existing svg
  let old = document.getElementById('nc-svg'); if (old) old.remove();
  const svg = document.createElementNS(svgNS,'svg'); svg.id='nc-svg'; svg.style.position='absolute'; overlay.appendChild(svg);
  contours.forEach(cont=>{
    const path = d3.geoPath(d3.geoIdentity().scale(1));
    // convert grid to geo-polygons
    const polygons = contourToPolygons(cont, grid);
    polygons.forEach(poly=>{
      const pathEl = document.createElementNS(svgNS,'path');
      const d = geoToPathD(poly);
      pathEl.setAttribute('d', d);
      pathEl.setAttribute('stroke','black');
      pathEl.setAttribute('fill','none');
      pathEl.setAttribute('stroke-width','1');
      svg.appendChild(pathEl);
    })
  });
}

function contourToPolygons(cont, grid){
  // cont.coordinates contains arrays of polygons in grid coordinates
  const polys = [];
  const nx = grid.lon[0].length, ny = grid.lat.length;
  cont.coordinates.forEach(rings=>{
    rings.forEach(ring=>{
      const poly = ring.map(pt=>{
        const x = pt[0], y = pt[1];
        // convert grid index to lon/lat (approx)
        const i = Math.max(0, Math.min(nx-1, Math.round(x)));
        const j = Math.max(0, Math.min(ny-1, Math.round(y)));
        return [grid.lon[j][i], grid.lat[j][i]];
      });
      polys.push(poly);
    });
  });
  return polys;
}

function geoToPathD(poly){
  // poly: array of [lon,lat]
  const pts = poly.map(p=>map.latLngToLayerPoint([p[1], p[0]]));
  let d = '';
  pts.forEach((pt,i)=>{ d += (i===0? 'M':'L') + pt.x + ' ' + pt.y; });
  d += 'Z';
  return d;
}

function loadGridFromJSON(jsonPath) {
  // Load pre-computed grid from JSON file (output by nc_to_json.py)
  fetch(jsonPath)
    .then(r => r.json())
    .then(data => {
      // Expected structure: {lon: [...], lat: [...], values: [...]}
      // Convert flat arrays to 2D if needed
      const nlon = data.lon.length;
      const nlat = data.lat.length;
      let lon2d, lat2d, values2d;
      
      if (Array.isArray(data.lon[0])) {
        // already 2D
        lon2d = data.lon;
        lat2d = data.lat;
        values2d = data.values;
      } else {
        // 1D lon/lat arrays; build 2D
        lon2d = new Array(nlat).fill(0).map((_,j) => new Array(nlon).fill(0).map((_,i)=>data.lon[i]));
        lat2d = new Array(nlat).fill(0).map((_,j) => new Array(nlon).fill(0).map((_,i)=>data.lat[j]));
        values2d = new Array(nlat).fill(0).map((_,j) => new Array(nlon).fill(0).map((_,i)=>data.values[j*nlon+i] || NaN));
      }
      
      currentGrid = {lon: lon2d, lat: lat2d, values: values2d};
      console.log('Grid loaded:', currentGrid);
      // Auto-draw
      drawIsobars(currentGrid);
    })
    .catch(err => {
      console.error('Failed to load JSON:', err);
      // Silently fail if file not found; user can upload NetCDF instead
    });
}

function onDraw() {
  try {
    console.log('onDraw called');
    const sel = document.getElementById('varSelect');
    const varName = sel ? sel.value : null;
    const plotType = document.getElementById('plotSelect').value;
    // If no dataset but a JSON grid is loaded, allow drawing from JSON
    if (!dataset && currentGrid && plotType !== 'composite') {
      console.log('No NetCDF loaded; using JSON grid');
      drawIsobars(currentGrid);
      return;
    }
    if (!dataset) { alert('请先上传或加载一个 NetCDF 文件（或确保页面已加载 JSON 网格）'); return; }
    if (!varName && plotType !== 'composite') { alert('请选择变量'); return; }
  const plotType = document.getElementById('plotSelect').value;
    if (plotType === 'composite') {
    // Attempt to find 500 hPa geopotential and 850 hPa winds
    const nc = dataset;
    const geoCandidate = findVarWithLevel(nc, ['z','geopotential','gh'], 500);
    const uCandidate = findVarWithLevel(nc, ['u','u_component_of_wind','u10'], 850);
    const vCandidate = findVarWithLevel(nc, ['v','v_component_of_wind','v10'], 850);
    let geoGrid = null, uGrid = null, vGrid = null;
    if (geoCandidate) geoGrid = extract2DAtLevel(nc, geoCandidate.varName, geoCandidate.levelIndex);
    if (uCandidate) uGrid = extract2DAtLevel(nc, uCandidate.varName, uCandidate.levelIndex);
    if (vCandidate) vGrid = extract2DAtLevel(nc, vCandidate.varName, vCandidate.levelIndex);
    if (!geoGrid && !uGrid && !vGrid) { alert('在文件中未找到可用于复合绘制的 500/850 hPa 要素'); return; }
    try { drawComposite(geoGrid, uGrid, vGrid); } catch(e) { console.error('drawComposite failed', e); alert('绘制复合图失败：' + e); }
    return;
  }
  // default: single-field isobars
  const grid = gridFromVar(varName);
  if (!grid) { alert('无法从文件中构建规则网格'); return; }
  try { drawIsobars(grid); } catch(e) { console.error('drawIsobars failed', e); alert('绘制等值线失败：' + e); }
  } catch(err) {
    console.error('onDraw top-level error', err);
    alert('生成图表时发生错误，请查看浏览器控制台 (F12) 以获取详情');
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  initMap();
  document.getElementById('fileInput').addEventListener('change', onFile);
  // 尝试自动从 JSON 加载网格（如果文件存在）
  try { loadGridFromJSON(dataFile); } catch(e) { console.warn('自动加载 JSON 失败', e); }
  document.getElementById('drawBtn').addEventListener('click', onDraw);
  document.getElementById('exportBtn').addEventListener('click', ()=>{
    exportMapPNG();
  });
  document.getElementById('makePicBtn').addEventListener('click', ()=>{
    // convenience: if a NetCDF file is selected, try to auto-draw then export
    try {
      const f = document.getElementById('fileInput').files[0];
      if (f) {
        // simulate file change -> onFile will draw automatically
        const evt = new Event('change');
        document.getElementById('fileInput').dispatchEvent(evt);
        setTimeout(()=>{ try { onDraw(); exportMapPNG(); } catch(e){ console.error(e); alert('生成失败：'+e); } }, 800);
      } else if (currentGrid) {
        onDraw(); exportMapPNG();
      } else {
        alert('请先使用页面上的文件选择上传 .nc 或先加载 JSON 数据');
      }
    } catch(e) { console.error(e); alert('Make Picture 发生错误：' + e); }
  });
  const mapEl = document.getElementById('map');
  if (!mapEl) { alert('找不到地图容器'); return; }
  if (typeof html2canvas === 'undefined') {
    alert('导出依赖 html2canvas，但当前页面未加载该库。请使用浏览器截图或联网后刷新页面重试。');
    return;
  }
  setStatus('正在生成图片...');
  html2canvas(mapEl, {useCORS:true, logging:false}).then(canvas=>{
    canvas.toBlob(function(blob){
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'era5_map.png'; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setStatus('图片已生成并下载');
    }, 'image/png');
  }).catch(err=>{
    console.error('exportMapPNG failed', err);
    alert('导出为图片失败，请查看控制台。');
    setStatus('导出失败');
  });
}
});
