// Search-area map for buyers: San Diego County ZIP codes that can be tapped
// on and off, plus free-form areas drawn with the shape tool.
(function () {
  if (!window.L) return;
  var zipData = null;
  function loadZips() { return zipData || (zipData = fetch('/sd-zips.json').then(function (r) { return r.json(); })); }
  var brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#121275';

  document.querySelectorAll('.areamap').forEach(function (el) {
    var edit = el.hasAttribute('data-edit');
    var form = el.closest('form');
    var zipInput = edit ? form.querySelector('[name=zips]') : null;
    var shapeInput = edit ? form.querySelector('[name=shapes]') : null;
    var readZips = function () { return new Set(((edit ? zipInput.value : el.dataset.zips) || '').match(/\d{5}/g) || []); };
    var zips = readZips();
    var shapes = null;
    try { shapes = JSON.parse((edit ? shapeInput.value : el.dataset.shapes) || 'null'); } catch (e) { /* no drawing */ }

    var map = L.map(el, { scrollWheelZoom: false }).setView([32.9, -117.05], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

    var drawn = L.featureGroup().addTo(map);
    var shapeStyle = { color: brand, weight: 3, fillColor: brand, fillOpacity: 0.15 };
    if (shapes) L.geoJSON(shapes, { style: shapeStyle }).eachLayer(function (l) { drawn.addLayer(l); });

    var zipLayer = null, drawing = false;
    function zipStyle(f) {
      var on = zips.has(f.properties.zip);
      return { color: on ? brand : '#8a90a6', weight: on ? 2 : 0.6, fillColor: brand, fillOpacity: on ? 0.3 : 0 };
    }
    function fit() {
      var b = L.latLngBounds([]);
      if (zipLayer) zipLayer.eachLayer(function (l) { if (zips.has(l.feature.properties.zip)) b.extend(l.getBounds()); });
      if (drawn.getLayers().length) b.extend(drawn.getBounds());
      if (b.isValid()) map.fitBounds(b.pad(0.25), { maxZoom: 13 });
    }
    loadZips().then(function (data) {
      zipLayer = L.geoJSON(data, {
        style: zipStyle,
        onEachFeature: function (f, layer) {
          layer.bindTooltip(f.properties.zip, { sticky: true });
          if (!edit) return;
          layer.on('click', function () {
            if (drawing) return;
            var z = f.properties.zip;
            if (zips.has(z)) zips.delete(z); else zips.add(z);
            zipInput.value = Array.from(zips).sort().join(', ');
            zipLayer.setStyle(zipStyle);
          });
        },
      }).addTo(map);
      zipLayer.bringToBack();
      fit();
    });

    if (edit) {
      zipInput.addEventListener('input', function () { zips = readZips(); if (zipLayer) zipLayer.setStyle(zipStyle); });
      map.addControl(new L.Control.Draw({
        draw: { polygon: { shapeOptions: shapeStyle, allowIntersection: false }, rectangle: false, circle: false, marker: false, polyline: false, circlemarker: false },
        edit: { featureGroup: drawn },
      }));
      var save = function () { shapeInput.value = drawn.getLayers().length ? JSON.stringify(drawn.toGeoJSON()) : ''; };
      map.on('draw:drawstart draw:editstart draw:deletestart', function () { drawing = true; });
      map.on('draw:drawstop draw:editstop draw:deletestop', function () { drawing = false; });
      map.on('draw:created', function (e) { drawn.addLayer(e.layer); save(); });
      map.on('draw:edited draw:deleted', save);
    }

    // A map inside a collapsed section has no size until the section opens.
    var holder = el.closest('details');
    while (holder) {
      holder.addEventListener('toggle', function () { map.invalidateSize(); fit(); });
      holder = holder.parentElement && holder.parentElement.closest('details');
    }
    el._map = map; // for testing
  });
})();
