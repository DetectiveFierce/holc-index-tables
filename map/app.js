/* School Maps Viewer - streamlined, dark-first Leaflet UI */
(async function () {
  'use strict';

  const DATA_PATH = 'data/response_by_school.csv';
  const CATCHMENT_PATH = 'data/catchments.geojson';
  const HOLC_PATH = 'data/holc.geojson';
  const PAGE_SIZE = 100;
  const TABLE_DEFAULT_HEIGHT = 250;
  const TABLE_MIN_HEIGHT = 160;
  const TABLE_COLLAPSED_HEIGHT = 46;

  const TABLE_COLS = [
    'stAbbrev', 'schnam', 'city_name', 'predominant_racial_group',
    'weighted_median_hh_income', 'weighted_pct_hs_diploma', 'weighted_gini_index',
    'avg_score', 'redlining_severity', 'diversity_score',
    'A', 'B', 'C', 'D', 'total_graded_pct'
  ];

  const COL_LABELS = {
    stAbbrev: 'State',
    schnam: 'School',
    city_name: 'City',
    predominant_racial_group: 'Racial Group',
    weighted_median_hh_income: 'Med. Income',
    weighted_pct_hs_diploma: 'HS Diploma %',
    weighted_gini_index: 'Gini',
    avg_score: 'Avg Score',
    redlining_severity: 'Redline Sev.',
    diversity_score: 'Diversity',
    A: 'HOLC A%',
    B: 'HOLC B%',
    C: 'HOLC C%',
    D: 'HOLC D%',
    total_graded_pct: 'Graded %'
  };

  const GRADE_KEYS = ['A', 'B', 'C', 'D'];

  const DEFAULT_COLORS = {
    catchments: '#b7a4c1',
    holc: '#d29922',
    response: '#ff9b47'
  };

  const HISTORICAL_HOLC_COLORS = Object.freeze({
    A: '#3fb950',
    B: '#58a6ff',
    C: '#d29922',
    D: '#f85149'
  });

  const DEFAULT_OPACITY = {
    catchments: 0.35,
    holc: 0.35,
    response: 0.3
  };

  const LAYER_BORDER_WEIGHT = 2.3;
  const LAYER_BORDER_OPACITY = 0.98;

  const STR_COLS = new Set([
    'schnam', 'stAbbrev', 'city', 'city_name', 'state', 'city_state',
    'predominant_racial_group', 'performance_category', 'grade_range'
  ]);

  const HIDDEN_STYLE = { fillOpacity: 0, opacity: 0, weight: 0 };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    main: $('main'),
    contentArea: $('#content-area'),
    mapContainer: $('#map-container'),
    tableContainer: $('#table-container'),
    tableResizeHandle: $('#table-resize-handle'),
    mapLegend: $('#map-legend'),
    layerList: $('#layer-list'),
    sidebarTabs: $$('.sidebar-tab'),
    sidebarPanels: {
      filters: $('#sidebar-panel-filters'),
      layers: $('#sidebar-panel-layers')
    },
    btnToggleSidebar: $('#btn-toggle-sidebar'),
    btnToggleTable: $('#btn-toggle-table'),
    btnPrev: $('#btn-prev'),
    btnNext: $('#btn-next'),
    btnExport: $('#btn-export'),
    btnReset: $('#btn-reset'),
    recordCount: $('#record-count'),
    tableCount: $('#table-count'),
    pageInfo: $('#page-info'),
    tableHead: $('#table-head'),
    tableBody: $('#table-body'),

    searchSchool: $('#search-school'),
    filterState: $('#filter-state'),
    filterCity: $('#filter-city'),
    filterRace: $('#filter-race'),

    incomeMin: $('#income-min'),
    incomeMax: $('#income-max'),
    diplomaMin: $('#diploma-min'),
    diplomaMax: $('#diploma-max'),
    giniMin: $('#gini-min'),
    giniMax: $('#gini-max'),
    scoreMin: $('#score-min'),
    scoreMax: $('#score-max'),
    severityMin: $('#severity-min'),
    severityMax: $('#severity-max'),
    diversityMin: $('#diversity-min'),
    diversityMax: $('#diversity-max'),

    holcFilters: $$('.holc-filter'),
    numberInputs: $$('input[type=number]'),
    filterInputs: $$('#sidebar-panel-filters input, #sidebar-panel-filters select'),

    layerCatchments: $('#layer-catchments'),
    layerHolc: $('#layer-holc'),
    layerResponse: $('#layer-response'),
    layerActiveCount: $('#layer-active-count'),
    showUnnamed: $('#show-unnamed'),

    catchmentColor: $('#catchment-color'),
    catchmentOpacity: $('#catchment-opacity'),
    catchmentOpacityValue: $('#catchment-opacity-value'),

    holcColor: $('#holc-color'),
    holcOpacity: $('#holc-opacity'),
    holcOpacityValue: $('#holc-opacity-value'),

    responseMetric: $('#response-metric'),
    responseColor: $('#response-color'),
    responseOpacity: $('#response-opacity'),
    responseOpacityValue: $('#response-opacity-value')
  };

  const state = {
    allData: [],
    filtered: [],
    filteredSchoolKeys: new Set(),
    page: 0,
    sortCol: null,
    sortAsc: true,
    debounceTimer: null,
    resizeTimer: null,
    initialized: false,
    responseMetric: dom.responseMetric.value,
    responseDomain: null,
    responseColorScale: null,
    catchmentGeo: null,
    holcGeo: null,
    catchmentLayer: null,
    holcLayer: null,
    responseLayer: null,
    tableExpandedHeight: TABLE_DEFAULT_HEIGHT,
    isResizingTable: false,
    tableResizePointerId: null,
    tableResizeStartY: 0,
    tableResizeStartHeight: TABLE_DEFAULT_HEIGHT,
    activeSelection: null,
    holcPaletteMode: 'historical',
    dataBySchool: new Map(),
    dataBySchoolState: new Map(),
    dragSource: null
  };

  const map = L.map('map', {
    center: [39.5, -98.0],
    zoom: 5,
    zoomControl: true,
    preferCanvas: true
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  map.on('popupclose', clearActiveSelection);

  setupStaticUiHandlers();
  setSidebarTab('filters');
  initTableHeader();

  const overlay = createLoadingOverlay();
  dom.mapContainer.appendChild(overlay);

  try {
    await loadAndPrepareData();
  } catch (error) {
    console.error(error);
    overlay.innerHTML = '<div class="loading-error">Unable to load viewer data. Check file paths in /Viewer/data.</div>';
    return;
  }

  buildCatchmentLayer();
  buildHolcLayer();
  if (dom.layerResponse.checked) buildResponseLayer();

  setupDynamicHandlers();

  overlay.remove();
  state.initialized = true;

  updateOpacityLabel(dom.catchmentOpacity, dom.catchmentOpacityValue, DEFAULT_OPACITY.catchments);
  updateOpacityLabel(dom.holcOpacity, dom.holcOpacityValue, DEFAULT_OPACITY.holc);
  updateOpacityLabel(dom.responseOpacity, dom.responseOpacityValue, DEFAULT_OPACITY.response);
  updateLayerSummary();
  applyFilters();

  function createLoadingOverlay() {
    const el = document.createElement('div');
    el.id = 'loading-overlay';
    el.innerHTML = '<div class="spinner"></div> Loading data...';
    return el;
  }

  async function loadAndPrepareData() {
    const [rawCSV, catchmentGeo, holcGeo] = await Promise.all([
      fetch(DATA_PATH).then(ensureOkText('CSV load failed')),
      fetch(CATCHMENT_PATH).then(ensureOkJson('Catchment load failed')),
      fetch(HOLC_PATH).then(ensureOkJson('HOLC load failed'))
    ]);

    state.catchmentGeo = catchmentGeo;
    state.holcGeo = holcGeo;

    state.allData = d3.csvParse(rawCSV, parseRow);
    buildSchoolLookups(state.allData);

    const states = uniqueSorted(state.allData.map(d => d.stAbbrev));
    const races = uniqueSorted(state.allData.map(d => d.predominant_racial_group));

    populateSelect(dom.filterState, states, 'All States');
    populateSelect(dom.filterRace, races, 'All Groups');
    refreshCityOptions();
  }

  function ensureOkText(message) {
    return response => {
      if (!response.ok) throw new Error(message);
      return response.text();
    };
  }

  function ensureOkJson(message) {
    return response => {
      if (!response.ok) throw new Error(message);
      return response.json();
    };
  }

  function parseRow(row) {
    for (const key of Object.keys(row)) {
      if (row[key] === 'NA' || row[key] === '') {
        row[key] = null;
      } else if (!STR_COLS.has(key) && !Number.isNaN(+row[key])) {
        row[key] = +row[key];
      }
    }

    row.__search = (row.schnam || '').toLowerCase();
    row.__schoolNorm = normalizeLookupPart(row.schnam);
    row.__stateNorm = normalizeLookupPart(row.stAbbrev);
    row.__schoolStateKey = schoolStateKey(row.__schoolNorm, row.__stateNorm);
    return row;
  }

  function normalizeLookupPart(value) {
    return (value || '').toString().trim().toUpperCase();
  }

  function schoolStateKey(schoolName, stateAbbrev) {
    return `${normalizeLookupPart(schoolName)}||${normalizeLookupPart(stateAbbrev)}`;
  }

  function buildSchoolLookups(rows) {
    state.dataBySchool.clear();
    state.dataBySchoolState.clear();

    const firstBySchool = new Map();
    const statesBySchool = new Map();

    for (const row of rows) {
      const schoolName = row.__schoolNorm;
      if (!schoolName) continue;

      if (!firstBySchool.has(schoolName)) firstBySchool.set(schoolName, row);

      const stateAbbrev = row.__stateNorm;
      if (!stateAbbrev) continue;

      state.dataBySchoolState.set(schoolStateKey(schoolName, stateAbbrev), row);
      if (!statesBySchool.has(schoolName)) statesBySchool.set(schoolName, new Set());
      statesBySchool.get(schoolName).add(stateAbbrev);
    }

    for (const [schoolName, row] of firstBySchool) {
      const states = statesBySchool.get(schoolName);
      if (states && states.size === 1) state.dataBySchool.set(schoolName, row);
    }
  }

  function getSchoolData(csvName, featureState) {
    const schoolName = normalizeLookupPart(csvName);
    if (!schoolName) return null;

    const stateAbbrev = normalizeLookupPart(featureState);
    if (stateAbbrev) {
      const exact = state.dataBySchoolState.get(schoolStateKey(schoolName, stateAbbrev));
      return exact || null;
    }

    return state.dataBySchool.get(schoolName) || null;
  }

  function getFeatureSchoolData(feature) {
    if (Object.prototype.hasOwnProperty.call(feature.properties, '__csvRow')) {
      return feature.properties.__csvRow;
    }

    const csvName = feature.properties.csvName;
    const schoolRow = getSchoolData(csvName, feature.properties.stAbbrev) || null;
    feature.properties.__csvRow = schoolRow;
    return schoolRow;
  }

  function uniqueSorted(values) {
    return [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  function populateSelect(selectEl, items, placeholder, selected = '') {
    selectEl.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    selectEl.appendChild(first);

    const fragment = document.createDocumentFragment();
    for (const value of items) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      fragment.appendChild(option);
    }
    selectEl.appendChild(fragment);

    if (selected && items.includes(selected)) {
      selectEl.value = selected;
    }
  }

  function refreshCityOptions() {
    const selectedState = dom.filterState.value;
    const currentCity = dom.filterCity.value;

    const cities = selectedState
      ? uniqueSorted(state.allData.filter(d => d.stAbbrev === selectedState).map(d => d.city_name))
      : uniqueSorted(state.allData.map(d => d.city_name));

    populateSelect(dom.filterCity, cities, 'All Cities', currentCity);
  }

  function setupStaticUiHandlers() {
    for (const tab of dom.sidebarTabs) {
      tab.addEventListener('click', () => setSidebarTab(tab.dataset.tab));
    }

    for (const btn of $$('.layer-expand-btn')) {
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const item = btn.closest('.layer-item');
        const panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (!item || !panel) return;

        const expanded = !item.classList.contains('is-expanded');
        item.classList.toggle('is-expanded', expanded);
        panel.classList.toggle('hidden', !expanded);
        btn.setAttribute('aria-expanded', String(expanded));
      });
    }

    dom.btnToggleSidebar.addEventListener('click', () => {
      const collapsed = dom.main.classList.toggle('sidebar-collapsed');
      dom.btnToggleSidebar.textContent = collapsed ? '☰ Show Sidebar' : '☰ Hide Sidebar';
      dom.btnToggleSidebar.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      dom.btnToggleSidebar.setAttribute('aria-expanded', String(!collapsed));
      refreshMapSize();
    });

    dom.btnToggleTable.addEventListener('click', () => {
      const shouldCollapse = !dom.tableContainer.classList.contains('collapsed');
      setTableCollapsed(shouldCollapse);
    });

    setupTableResizer();
    setupLayerReordering();
  }

  function setupDynamicHandlers() {
    dom.layerCatchments.addEventListener('change', () => {
      buildCatchmentLayer();
      updateLayerSummary();
    });

    dom.showUnnamed.addEventListener('change', buildCatchmentLayer);

    dom.catchmentColor.addEventListener('input', () => {
      applyCatchmentStyle();
    });

    dom.catchmentOpacity.addEventListener('input', () => {
      updateOpacityLabel(dom.catchmentOpacity, dom.catchmentOpacityValue, DEFAULT_OPACITY.catchments);
      applyCatchmentStyle();
    });

    dom.layerHolc.addEventListener('change', () => {
      if (dom.layerHolc.checked) {
        state.holcLayer.addTo(map);
      } else {
        clearActiveSelectionForLayer('holc');
        map.removeLayer(state.holcLayer);
      }
      updateLayerSummary();
      updateLegendVisibility();
      reorderMapLayers();
    });

    dom.holcColor.addEventListener('input', () => {
      state.holcPaletteMode = 'custom';
      applyHolcStyle();
      updateLegendVisibility();
    });

    dom.holcOpacity.addEventListener('input', () => {
      updateOpacityLabel(dom.holcOpacity, dom.holcOpacityValue, DEFAULT_OPACITY.holc);
      applyHolcStyle();
      updateLegendVisibility();
    });

    dom.layerResponse.addEventListener('change', () => {
      if (dom.layerResponse.checked) {
        buildResponseLayer();
      } else if (state.responseLayer) {
        clearActiveSelectionForLayer('response');
        map.removeLayer(state.responseLayer);
        state.responseLayer = null;
      }

      updateLayerSummary();
      updateLegendVisibility();
    });

    dom.responseMetric.addEventListener('change', () => {
      state.responseMetric = dom.responseMetric.value;
      if (dom.layerResponse.checked) buildResponseLayer();
    });

    dom.responseColor.addEventListener('input', () => {
      if (!dom.layerResponse.checked || !state.responseLayer || !state.responseDomain) return;
      const [lo, hi] = state.responseDomain;
      state.responseColorScale = d3.scaleSequential(responseInterpolator()).domain([lo, hi]);
      state.responseLayer.setStyle(responseFeatureStyle);
      renderResponseLegend(lo, hi);
    });

    dom.responseOpacity.addEventListener('input', () => {
      updateOpacityLabel(dom.responseOpacity, dom.responseOpacityValue, DEFAULT_OPACITY.response);
      if (dom.layerResponse.checked && state.responseLayer) {
        state.responseLayer.setStyle(responseFeatureStyle);
      }
    });

    dom.btnPrev.addEventListener('click', () => {
      state.page = Math.max(0, state.page - 1);
      renderTable();
    });

    dom.btnNext.addEventListener('click', () => {
      const maxPage = Math.max(0, Math.ceil(state.filtered.length / PAGE_SIZE) - 1);
      state.page = Math.min(maxPage, state.page + 1);
      renderTable();
    });

    dom.btnExport.addEventListener('click', exportFilteredCsv);
    dom.btnReset.addEventListener('click', resetFilters);

    dom.filterState.addEventListener('change', () => {
      refreshCityOptions();
      debouncedFilter();
    });

    for (const input of dom.filterInputs) {
      if (input === dom.filterState) continue;
      const eventName = input.type === 'text' || input.type === 'number' ? 'input' : 'change';
      input.addEventListener(eventName, debouncedFilter);
    }
  }

  function setSidebarTab(tabKey) {
    for (const button of dom.sidebarTabs) {
      const isActive = button.dataset.tab === tabKey;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    }

    for (const [key, panel] of Object.entries(dom.sidebarPanels)) {
      panel.classList.toggle('is-active', key === tabKey);
    }
  }

  function refreshMapSize() {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => map.invalidateSize(), 220);
  }

  function currentTableHeight() {
    return Math.round(dom.tableContainer.getBoundingClientRect().height);
  }

  function maxTableHeight() {
    const contentHeight = dom.contentArea ? dom.contentArea.clientHeight : 0;
    const mapMin = parseFloat(getComputedStyle(dom.mapContainer).minHeight) || 220;
    const layoutAllowance = 18;
    return Math.max(TABLE_MIN_HEIGHT, contentHeight - mapMin - layoutAllowance);
  }

  function clampTableHeight(height) {
    return Math.max(TABLE_MIN_HEIGHT, Math.min(maxTableHeight(), Math.round(height)));
  }

  function applyTableHeight(height) {
    const clamped = clampTableHeight(height);
    dom.tableContainer.style.height = `${clamped}px`;
    dom.tableContainer.style.minHeight = `${clamped}px`;
    state.tableExpandedHeight = clamped;
    return clamped;
  }

  function setTableCollapsed(collapsed) {
    dom.tableContainer.classList.toggle('collapsed', collapsed);
    dom.btnToggleTable.textContent = collapsed ? '▸ Show Table' : '▾ Hide Table';
    dom.btnToggleTable.title = collapsed ? 'Expand table' : 'Collapse table';
    dom.btnToggleTable.setAttribute('aria-expanded', String(!collapsed));

    if (collapsed) {
      if (state.isResizingTable) onTableResizeEnd();
      dom.tableContainer.style.height = `${TABLE_COLLAPSED_HEIGHT}px`;
      dom.tableContainer.style.minHeight = `${TABLE_COLLAPSED_HEIGHT}px`;
    } else {
      const startHeight = state.tableExpandedHeight || currentTableHeight() || TABLE_DEFAULT_HEIGHT;
      applyTableHeight(startHeight);
    }

    refreshMapSize();
  }

  function onTableResizeMove(event) {
    if (!state.isResizingTable || event.pointerId !== state.tableResizePointerId) return;
    const deltaY = state.tableResizeStartY - event.clientY;
    applyTableHeight(state.tableResizeStartHeight + deltaY);
    map.invalidateSize(false);
  }

  function onTableResizeEnd(event) {
    if (!state.isResizingTable) return;
    if (event && event.pointerId != null && event.pointerId !== state.tableResizePointerId) return;

    state.isResizingTable = false;
    state.tableResizePointerId = null;
    dom.tableContainer.classList.remove('is-resizing');

    document.removeEventListener('pointermove', onTableResizeMove);
    document.removeEventListener('pointerup', onTableResizeEnd);
    document.removeEventListener('pointercancel', onTableResizeEnd);

    refreshMapSize();
  }

  function setupTableResizer() {
    if (!dom.tableResizeHandle) return;

    const initialHeight = currentTableHeight();
    if (Number.isFinite(initialHeight) && initialHeight > TABLE_COLLAPSED_HEIGHT) {
      state.tableExpandedHeight = initialHeight;
    }

    dom.tableResizeHandle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();

      if (dom.tableContainer.classList.contains('collapsed')) setTableCollapsed(false);

      state.isResizingTable = true;
      state.tableResizePointerId = event.pointerId;
      state.tableResizeStartY = event.clientY;
      state.tableResizeStartHeight = currentTableHeight();

      dom.tableContainer.classList.add('is-resizing');

      document.addEventListener('pointermove', onTableResizeMove);
      document.addEventListener('pointerup', onTableResizeEnd);
      document.addEventListener('pointercancel', onTableResizeEnd);
    });

    window.addEventListener('resize', () => {
      if (dom.tableContainer.classList.contains('collapsed')) return;
      applyTableHeight(state.tableExpandedHeight || TABLE_DEFAULT_HEIGHT);
    });
  }

  function selectedOpacity(inputEl, fallback) {
    const value = Number(inputEl.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function updateOpacityLabel(inputEl, outputEl, fallback) {
    const percent = Math.round(selectedOpacity(inputEl, fallback) * 100);
    outputEl.textContent = `${percent}%`;
  }

  function borderColorFor(fillColor) {
    const base = d3.hsl(fillColor || '#8b8b8b');
    const saturated = Math.min(1, Math.max(0.28, base.s * 1.18));
    const darker = Math.max(0.12, base.l * 0.48);
    return d3.hsl(base.h, saturated, darker).formatHex();
  }

  function catchmentStyle() {
    const fillColor = dom.catchmentColor.value || DEFAULT_COLORS.catchments;
    const fillOpacity = selectedOpacity(dom.catchmentOpacity, DEFAULT_OPACITY.catchments);

    return {
      color: borderColorFor(fillColor),
      fillColor,
      weight: LAYER_BORDER_WEIGHT,
      opacity: LAYER_BORDER_OPACITY,
      fillOpacity,
      lineCap: 'round',
      lineJoin: 'round'
    };
  }

  function featureHasName(feature) {
    if (feature.properties.csvName) return true;
    const sourceName = (feature.properties.SrcName || '').trim();
    return sourceName.length > 2;
  }

  function getFeatureDisplayName(feature) {
    const csvName = feature.properties.csvName;
    if (csvName) return csvName;

    const sourceName = (feature.properties.SrcName || '').trim();
    return sourceName.length > 2 ? sourceName : null;
  }

  function buildCatchmentLayer() {
    const wasOnMap = state.catchmentLayer && map.hasLayer(state.catchmentLayer);
    if (state.catchmentLayer) {
      clearActiveSelectionForLayer('catchments');
      map.removeLayer(state.catchmentLayer);
      state.catchmentLayer = null;
    }

    if (!dom.layerCatchments.checked) return;

    const showUnnamed = dom.showUnnamed.checked;

    state.catchmentLayer = L.geoJSON(state.catchmentGeo, {
      filter: feature => showUnnamed || featureHasName(feature),
      style: catchmentStyle(),
      onEachFeature: (feature, layer) => {
        const displayName = getFeatureDisplayName(feature);
        if (!displayName) return;

        const schoolData = getFeatureSchoolData(feature);
        let html = `<strong>${displayName}</strong>`;

        const featureState = feature.properties.stAbbrev || null;
        if (featureState) html += `<br>State: ${featureState}`;
        if (feature.properties.ncessch) html += `<br>NCES: ${feature.properties.ncessch}`;

        if (schoolData) {
          if (schoolData.city_name) html += `<br>City: ${schoolData.city_name}`;
          if (schoolData.avg_score != null) html += `<br>Avg Score: ${schoolData.avg_score.toFixed(1)}`;
        }

        layer.bindPopup(html);
        bindSelectionHighlight(layer, 'catchments');
      }
    });

    state.catchmentLayer.addTo(map);
    if (state.initialized || wasOnMap) reorderMapLayers();
  }

  function applyCatchmentStyle() {
    if (!state.catchmentLayer || !map.hasLayer(state.catchmentLayer)) return;
    state.catchmentLayer.setStyle(catchmentStyle());
  }

  function holcPalette() {
    if (state.holcPaletteMode === 'historical') return HISTORICAL_HOLC_COLORS;

    const base = d3.hsl(dom.holcColor.value || DEFAULT_COLORS.holc);
    return {
      A: d3.hsl(base.h, Math.max(0.25, base.s * 0.7), Math.min(0.78, base.l + 0.22)).formatHex(),
      B: d3.hsl(base.h, Math.max(0.3, base.s * 0.85), Math.min(0.66, base.l + 0.1)).formatHex(),
      C: d3.hsl(base.h, Math.max(0.35, base.s), Math.max(0.36, base.l - 0.08)).formatHex(),
      D: d3.hsl(base.h, Math.min(1, base.s * 1.1), Math.max(0.2, base.l - 0.22)).formatHex()
    };
  }

  function holcStyle(feature) {
    const colors = holcPalette();
    const fillOpacity = selectedOpacity(dom.holcOpacity, DEFAULT_OPACITY.holc);
    const grade = feature.properties.grade;
    const fillColor = colors[grade] || '#888888';

    return {
      color: borderColorFor(fillColor),
      fillColor,
      weight: LAYER_BORDER_WEIGHT,
      opacity: LAYER_BORDER_OPACITY,
      fillOpacity,
      lineCap: 'round',
      lineJoin: 'round'
    };
  }

  function buildHolcLayer() {
    state.holcLayer = L.geoJSON(state.holcGeo, {
      style: holcStyle,
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        layer.bindPopup(`<strong>HOLC ${props.grade}</strong> - ${props.label}<br>${props.city}, ${props.state}`);
        bindSelectionHighlight(layer, 'holc');
      }
    });

    if (dom.layerHolc.checked) state.holcLayer.addTo(map);
  }

  function applyHolcStyle() {
    if (!state.holcLayer) return;
    state.holcLayer.setStyle(holcStyle);
  }

  function responseInterpolator() {
    const base = d3.hsl(dom.responseColor.value || DEFAULT_COLORS.response);
    const mid = d3.hsl(
      base.h,
      Math.max(0.72, base.s * 0.95),
      Math.min(0.6, Math.max(0.48, base.l))
    );
    const left = d3.hsl(
      (mid.h - 18 + 360) % 360,
      Math.min(1, Math.max(0.78, mid.s * 1.08)),
      Math.max(0.2, mid.l - 0.22)
    ).formatHex();
    const midHex = mid.formatHex();
    const right = '#fffaf5';
    const leftToMid = d3.interpolateLab(left, midHex);
    const midToRight = d3.interpolateLab(midHex, right);

    return t => {
      const clamped = Math.max(0, Math.min(1, t));
      if (clamped <= 0.5) return leftToMid(clamped * 2);
      return midToRight((clamped - 0.5) * 2);
    };
  }

  function responseFeatureStyle(feature) {
    const schoolData = getFeatureSchoolData(feature);
    if (!schoolData) return HIDDEN_STYLE;
    if (!state.filteredSchoolKeys.has(schoolData.__schoolStateKey)) return HIDDEN_STYLE;

    const value = schoolData[state.responseMetric];
    if (value == null || !Number.isFinite(value) || !state.responseColorScale) return HIDDEN_STYLE;

    const fillColor = state.responseColorScale(value);
    const fillOpacity = selectedOpacity(dom.responseOpacity, DEFAULT_OPACITY.response);

    return {
      color: fillColor,
      fillColor,
      weight: LAYER_BORDER_WEIGHT,
      opacity: LAYER_BORDER_OPACITY,
      fillOpacity,
      lineCap: 'round',
      lineJoin: 'round'
    };
  }

  function buildResponseLayer() {
    if (state.responseLayer) {
      clearActiveSelectionForLayer('response');
      map.removeLayer(state.responseLayer);
      state.responseLayer = null;
    }

    state.responseMetric = dom.responseMetric.value;

    const values = state.filtered
      .map(d => d[state.responseMetric])
      .filter(v => v != null && Number.isFinite(v));

    if (!values.length) {
      state.responseDomain = null;
      state.responseColorScale = null;
      updateLegendVisibility();
      return;
    }

    const lo = d3.min(values);
    const hi = d3.max(values);

    state.responseDomain = [lo, hi];
    state.responseColorScale = d3.scaleSequential(responseInterpolator()).domain([lo, hi]);

    state.responseLayer = L.geoJSON(state.catchmentGeo, {
      filter: feature => {
        const schoolData = getFeatureSchoolData(feature);
        if (!schoolData) return false;
        if (!state.filteredSchoolKeys.has(schoolData.__schoolStateKey)) return false;
        const value = schoolData[state.responseMetric];
        return value != null && Number.isFinite(value);
      },
      style: responseFeatureStyle,
      onEachFeature: (feature, layer) => {
        layer.bindPopup(() => {
          const schoolData = getFeatureSchoolData(feature);
          const metricLabel = dom.responseMetric.selectedOptions[0].textContent;
          const schoolName = feature.properties.SrcName || feature.properties.csvName || 'Unknown';
          const value = schoolData ? schoolData[state.responseMetric] : null;
          return `<strong>${schoolName}</strong><br>${metricLabel}: ${value != null ? fmt(value) : '-'}`;
        });
        bindSelectionHighlight(layer, 'response');
      }
    });

    if (dom.layerResponse.checked) state.responseLayer.addTo(map);

    renderResponseLegend(lo, hi);

    if (state.initialized) reorderMapLayers();
  }

  function renderResponseLegend(lo, hi) {
    if (!state.responseColorScale) {
      updateLegendVisibility();
      return;
    }

    const metricLabel = dom.responseMetric.selectedOptions[0].textContent;
    const mid = lo + (hi - lo) / 2;

    dom.mapLegend.innerHTML = `
      <div class="legend-title">${metricLabel}</div>
      <div class="legend-bar" style="background: linear-gradient(to right, ${state.responseColorScale(lo)}, ${state.responseColorScale(mid)}, ${state.responseColorScale(hi)})"></div>
      <div class="legend-labels"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></div>
    `;

    dom.mapLegend.classList.remove('hidden');
  }

  function renderHolcLegend() {
    const colors = holcPalette();

    dom.mapLegend.innerHTML = `
      <div class="legend-title">HOLC Grades</div>
      <div class="legend-holc">
        <div class="legend-holc-item"><div class="legend-swatch" style="background:${colors.A}"></div>A - Best</div>
        <div class="legend-holc-item"><div class="legend-swatch" style="background:${colors.B}"></div>B - Desirable</div>
        <div class="legend-holc-item"><div class="legend-swatch" style="background:${colors.C}"></div>C - Declining</div>
        <div class="legend-holc-item"><div class="legend-swatch" style="background:${colors.D}"></div>D - Hazardous</div>
      </div>
    `;

    dom.mapLegend.classList.remove('hidden');
  }

  function renderEmptyLegend() {
    const metricLabel = dom.responseMetric.selectedOptions[0].textContent;
    dom.mapLegend.innerHTML = `
      <div class="legend-title">${metricLabel}</div>
      <div class="legend-empty">No map values for the current filter set.</div>
    `;
    dom.mapLegend.classList.remove('hidden');
  }

  function updateLegendVisibility() {
    if (dom.layerResponse.checked) {
      if (state.responseDomain && state.responseColorScale) {
        renderResponseLegend(state.responseDomain[0], state.responseDomain[1]);
      } else {
        renderEmptyLegend();
      }
      return;
    }

    if (dom.layerHolc.checked) {
      renderHolcLegend();
      return;
    }

    dom.mapLegend.classList.add('hidden');
  }

  function updateLayerSummary() {
    const active = [dom.layerResponse, dom.layerHolc, dom.layerCatchments].filter(el => el.checked).length;
    dom.layerActiveCount.textContent = String(active);
  }

  function selectionHighlightStyle(layerOptions = {}) {
    const baseWeight = Number(layerOptions.weight);
    const baseFillOpacity = Number(layerOptions.fillOpacity);
    const baseStrokeColor = layerOptions.color || '#d0d0d0';
    const highlightedStroke = d3.color(baseStrokeColor);

    return {
      color: highlightedStroke ? highlightedStroke.brighter(1.1).formatHex() : '#ffffff',
      weight: (Number.isFinite(baseWeight) ? baseWeight : LAYER_BORDER_WEIGHT) + 1.8,
      opacity: 1,
      fillOpacity: Math.min(0.95, (Number.isFinite(baseFillOpacity) ? baseFillOpacity : 0.35) + 0.16)
    };
  }

  function setActiveSelection(featureLayer, layerKey) {
    if (!featureLayer || typeof featureLayer.setStyle !== 'function') return;
    if (state.activeSelection && state.activeSelection.featureLayer === featureLayer && state.activeSelection.layerKey === layerKey) return;

    clearActiveSelection();
    featureLayer.setStyle(selectionHighlightStyle(featureLayer.options));
    state.activeSelection = { featureLayer, layerKey };
  }

  function clearActiveSelection() {
    if (!state.activeSelection) return;

    const { featureLayer, layerKey } = state.activeSelection;
    state.activeSelection = null;

    const parentLayer = getLayerByKey(layerKey);
    if (!parentLayer || typeof parentLayer.resetStyle !== 'function' || !featureLayer) return;

    try {
      parentLayer.resetStyle(featureLayer);
    } catch (error) {
      /* no-op: selection belonged to a layer that was rebuilt or removed */
    }
  }

  function clearActiveSelectionForLayer(layerKey) {
    if (!state.activeSelection || state.activeSelection.layerKey !== layerKey) return;
    clearActiveSelection();
  }

  function bindSelectionHighlight(featureLayer, layerKey) {
    featureLayer.on('popupopen', () => setActiveSelection(featureLayer, layerKey));
  }

  function getLayerByKey(key) {
    if (key === 'catchments') return state.catchmentLayer;
    if (key === 'holc') return state.holcLayer;
    if (key === 'response') return state.responseLayer;
    return null;
  }

  function setupLayerReordering() {
    dom.layerList.addEventListener('dragstart', event => {
      const item = event.target.closest('.layer-item');
      if (!item) return;

      if (!event.target.closest('.drag-handle')) {
        event.preventDefault();
        return;
      }

      state.dragSource = item;
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.layer || '');
    });

    dom.layerList.addEventListener('dragend', event => {
      const item = event.target.closest('.layer-item');
      if (item) item.classList.remove('dragging');
      for (const child of dom.layerList.children) {
        child.classList.remove('drag-over');
      }
    });

    dom.layerList.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      const item = event.target.closest('.layer-item');
      if (!item || item === state.dragSource) return;

      for (const child of dom.layerList.children) {
        child.classList.remove('drag-over');
      }
      item.classList.add('drag-over');
    });

    dom.layerList.addEventListener('drop', event => {
      event.preventDefault();
      const target = event.target.closest('.layer-item');

      if (!target || target === state.dragSource) return;

      const items = [...dom.layerList.children];
      const sourceIndex = items.indexOf(state.dragSource);
      const targetIndex = items.indexOf(target);

      if (sourceIndex < targetIndex) {
        dom.layerList.insertBefore(state.dragSource, target.nextSibling);
      } else {
        dom.layerList.insertBefore(state.dragSource, target);
      }

      target.classList.remove('drag-over');
      reorderMapLayers();
    });
  }

  function reorderMapLayers() {
    const items = [...dom.layerList.children];

    for (let i = items.length - 1; i >= 0; i--) {
      const layer = getLayerByKey(items[i].dataset.layer);
      if (layer && map.hasLayer(layer)) layer.bringToFront();
    }
  }

  function debouncedFilter() {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(applyFilters, 220);
  }

  function numVal(inputEl) {
    const value = inputEl.value;
    return value === '' ? null : +value;
  }

  function rangeOk(value, min, max) {
    if (min !== null && (value == null || value < min)) return false;
    if (max !== null && (value == null || value > max)) return false;
    return true;
  }

  function applyFilters() {
    const searchTerm = (dom.searchSchool.value || '').trim().toLowerCase();
    const selectedState = dom.filterState.value;
    const selectedCity = dom.filterCity.value;
    const selectedRace = dom.filterRace.value;

    const rangeFilters = {
      incomeMin: numVal(dom.incomeMin),
      incomeMax: numVal(dom.incomeMax),
      diplomaMin: numVal(dom.diplomaMin),
      diplomaMax: numVal(dom.diplomaMax),
      giniMin: numVal(dom.giniMin),
      giniMax: numVal(dom.giniMax),
      scoreMin: numVal(dom.scoreMin),
      scoreMax: numVal(dom.scoreMax),
      severityMin: numVal(dom.severityMin),
      severityMax: numVal(dom.severityMax),
      diversityMin: numVal(dom.diversityMin),
      diversityMax: numVal(dom.diversityMax)
    };

    const selectedHolc = dom.holcFilters.filter(cb => cb.checked).map(cb => cb.value);

    state.filtered = state.allData.filter(row => {
      if (searchTerm && !row.__search.includes(searchTerm)) return false;
      if (selectedState && row.stAbbrev !== selectedState) return false;
      if (selectedCity && row.city_name !== selectedCity) return false;
      if (selectedRace && row.predominant_racial_group !== selectedRace) return false;

      if (!rangeOk(row.weighted_median_hh_income, rangeFilters.incomeMin, rangeFilters.incomeMax)) return false;
      if (!rangeOk(row.weighted_pct_hs_diploma, rangeFilters.diplomaMin, rangeFilters.diplomaMax)) return false;
      if (!rangeOk(row.weighted_gini_index, rangeFilters.giniMin, rangeFilters.giniMax)) return false;
      if (!rangeOk(row.avg_score, rangeFilters.scoreMin, rangeFilters.scoreMax)) return false;
      if (!rangeOk(row.redlining_severity, rangeFilters.severityMin, rangeFilters.severityMax)) return false;
      if (!rangeOk(row.diversity_score, rangeFilters.diversityMin, rangeFilters.diversityMax)) return false;

      if (selectedHolc.length < GRADE_KEYS.length) {
        const hasSelectedGrade = selectedHolc.some(grade => row[grade] != null && row[grade] > 0);
        if (!hasSelectedGrade) return false;
      }

      return true;
    });

    state.filteredSchoolKeys = new Set(state.filtered.map(row => row.__schoolStateKey));

    if (state.sortCol) sortFiltered();

    const maxPage = Math.max(0, Math.ceil(state.filtered.length / PAGE_SIZE) - 1);
    state.page = Math.min(state.page, maxPage);

    updateBadge();
    renderTable();

    if (dom.layerResponse.checked) {
      buildResponseLayer();
    } else {
      updateLegendVisibility();
    }
  }

  function updateBadge() {
    dom.recordCount.textContent = `${state.filtered.length.toLocaleString()} / ${state.allData.length.toLocaleString()} schools`;
    dom.tableCount.textContent = state.filtered.length.toLocaleString();
  }

  function fmt(value) {
    if (value == null) return '-';
    if (value >= 1000) return d3.format(',.0f')(value);
    if (value >= 10) return d3.format('.1f')(value);
    return d3.format('.3f')(value);
  }

  function initTableHeader() {
    const fragment = document.createDocumentFragment();

    for (const col of TABLE_COLS) {
      const th = document.createElement('th');
      th.textContent = COL_LABELS[col] || col;
      th.dataset.col = col;
      th.addEventListener('click', () => {
        if (state.sortCol === col) {
          state.sortAsc = !state.sortAsc;
        } else {
          state.sortCol = col;
          state.sortAsc = true;
        }

        sortFiltered();
        renderTable();
      });

      fragment.appendChild(th);
    }

    dom.tableHead.replaceChildren(fragment);
  }

  function updateTableSortState() {
    for (const th of dom.tableHead.children) {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.col === state.sortCol) {
        th.classList.add(state.sortAsc ? 'sort-asc' : 'sort-desc');
      }
    }
  }

  function renderTable() {
    updateTableSortState();

    const start = state.page * PAGE_SIZE;
    const pageRows = state.filtered.slice(start, start + PAGE_SIZE);

    const fragment = document.createDocumentFragment();

    if (!pageRows.length) {
      const tr = document.createElement('tr');
      tr.className = 'table-empty-row';
      const td = document.createElement('td');
      td.colSpan = TABLE_COLS.length;
      td.className = 'table-empty';
      td.textContent = 'No schools match the active filters.';
      tr.appendChild(td);
      fragment.appendChild(tr);
    } else {
      for (const row of pageRows) {
        const tr = document.createElement('tr');

        for (const col of TABLE_COLS) {
          const td = document.createElement('td');
          const value = row[col];
          td.textContent = value == null ? '-' : (typeof value === 'number' ? fmt(value) : value);
          tr.appendChild(td);
        }

        fragment.appendChild(tr);
      }
    }

    dom.tableBody.replaceChildren(fragment);

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    dom.pageInfo.textContent = `Page ${state.page + 1} of ${totalPages}`;
    dom.btnPrev.disabled = state.page === 0;
    dom.btnNext.disabled = state.page >= totalPages - 1;
  }

  function sortFiltered() {
    if (!state.sortCol) return;

    state.filtered.sort((a, b) => {
      const valueA = a[state.sortCol];
      const valueB = b[state.sortCol];

      if (valueA == null && valueB == null) return 0;
      if (valueA == null) return 1;
      if (valueB == null) return -1;

      if (typeof valueA === 'string') {
        return state.sortAsc ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA);
      }

      return state.sortAsc ? valueA - valueB : valueB - valueA;
    });
  }

  function csvEscape(value) {
    if (value == null) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  function exportFilteredCsv() {
    const header = `${TABLE_COLS.join(',')}\n`;
    const rows = state.filtered
      .map(row => TABLE_COLS.map(col => csvEscape(row[col])).join(','))
      .join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'filtered_schools.csv';
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function resetFilters() {
    dom.searchSchool.value = '';
    dom.filterState.value = '';
    refreshCityOptions();
    dom.filterCity.value = '';
    dom.filterRace.value = '';

    for (const input of dom.numberInputs) {
      input.value = '';
    }

    for (const checkbox of dom.holcFilters) {
      checkbox.checked = true;
    }

    state.sortCol = null;
    state.sortAsc = true;
    state.page = 0;

    applyFilters();
  }

})();
