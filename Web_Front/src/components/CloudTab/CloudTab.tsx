import { Suspense, useState, useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import SampleCloud from '../SampleCloud';
import { isTauri } from '../../audioLinking';
import GraphOptionsMenu from './GraphOptionsMenu';
import GroupsMenu from './GroupsMenu'
import { taxonomyKeys } from '../../groupColors';
import ShapesMenu from './ShapesMenu';
import { WebGLBoundary, webglAvailable } from './WebGLBoundary';

interface CloudTabProps {
  analysisResult: any[];
  // The SCOPED set (scope bar + text filter), BEFORE the Groups-menu hide is applied — so the
  // menu can still list a hidden category to toggle it back. The cloud masks hidden points
  // itself; hiding removes them from every OTHER tab via App's post-hide `filteredData`.
  filteredData: any[];
  // The Groups-menu hide/show set, now owned by App (global filter). See App.tsx.
  hiddenGroups: Set<string>;
  setHiddenGroups: Dispatch<SetStateAction<Set<string>>>;
  audioFiles: File[];
  onSound?: (name: string) => void;
  selectedItem?: any;
  playing?: boolean;
  // Open the selected file in the Examiner / Extractor (filtered to its name).
  onExamine?: (name: string) => void;
  onExtract?: (name: string) => void;
}

// v2: the saved prefs are from the old taxonomy. A stored colorBy of 'Group' would
// override the new UCS default (so the 3D scope bar would keep listing roles), and a
// stored 'God Category' is now a dead option that no longer exists in the select.
// Bumping the prefix retires both in one go.
const PREF = 'scanalyzer_cloud_v2_';
const getPref = (key: string, def: string) => localStorage.getItem(PREF + key) || def;

// Shown in place of the 3D cloud when WebGL can't start. The rest of the app (the 2D view,
// Stats, Examiner, Extractor) doesn't need the GPU and keeps working.
function WebGLUnavailable() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
      <div style={{ fontSize: '2rem' }}>🧊</div>
      <div style={{ color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 600 }}>3D view unavailable</div>
      <div style={{ fontSize: '0.85rem', maxWidth: 460, lineHeight: 1.5 }}>
        WebGL couldn't start in this environment (GPU disabled, a sandboxed webview, or
        hardware acceleration turned off). Everything else — the 2D view, Stats, Examiner and
        Extractor — works without it. Enable hardware acceleration / GPU access to restore the
        3D cloud.
      </div>
    </div>
  );
}

export default function CloudTab({
  filteredData, hiddenGroups, setHiddenGroups, audioFiles, onSound, selectedItem, playing
}: CloudTabProps) {
  const [xAxis, setXAxis] = useState(() => getPref('xAxis', 'Pitch'));
  const [yAxis, setYAxis] = useState(() => getPref('yAxis', 'Group'));
  const [zAxis, setZAxis] = useState(() => getPref('zAxis', 'Complexity'));
  const [sizeAxis, setSizeAxis] = useState(() => getPref('sizeAxis', 'Length'));
  // UCS is the only taxonomy now, so a stored colour of 'Group'/'Music Production'/
  // 'Subgroup' from the old switch is retired to the UCS default rather than honoured.
  const [colorBy, setColorBy] = useState(() => {
    const c = getPref('colorBy', 'UCS Category');
    return c.startsWith('UCS') ? c : 'UCS Category';
  });
  const [shapeBy, setShapeBy] = useState(() => getPref('shapeBy', 'Instrument'));

  // UCS is king. The 3D view speaks one taxonomy, and this is it — no per-record role,
  // no switch, no colour-mode-derived second axis of meaning.
  const taxonomy = 'UCS' as const;

  const data = filteredData;

  useEffect(() => {
    localStorage.setItem(PREF + 'xAxis', xAxis);
    localStorage.setItem(PREF + 'yAxis', yAxis);
    localStorage.setItem(PREF + 'zAxis', zAxis);
    localStorage.setItem(PREF + 'sizeAxis', sizeAxis);
    localStorage.setItem(PREF + 'colorBy', colorBy);
    localStorage.setItem(PREF + 'shapeBy', shapeBy);
  }, [xAxis, yAxis, zAxis, sizeAxis, colorBy, shapeBy]);
  const [showAxes, setShowAxes] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Hidden on first view — the cloud shows unobstructed, and the ⚙ button opens the
  // options overlay when wanted (on any screen size).
  const [showGraphOptions, setShowGraphOptions] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  // Checked once: if WebGL can't start (GPU disabled / sandboxed webview / headless), the
  // 3D view shows a message instead of throwing an uncaught three.js error.
  const [glOk] = useState(webglAvailable);

  // Distinct groups → their subgroups, with per-group and per-subgroup file
  // counts, for the nested legend.
  // Which taxonomy the cloud is showing. Derived from the colour choice, so the
  // legend and the hide/show filters always describe what you are actually
  // looking at — colour by UCS and the tree becomes UCS category -> subcategory.
  //
  // Built from `data` (= filteredData), NOT the whole `analysisResult`. The Groups menu is
  // the cloud's own show/hide control, so it must describe the SAME population the cloud is
  // drawing: after the scope bar / text filter narrows the view, the menu lists only the
  // categories actually on screen, with matching counts. Building it from the full library
  // was the "filter doesn't work" bug — it listed every category with whole-library counts,
  // so hiding one the scope had already excluded was a no-op the user read as a dead click.
  const groupTree = useMemo(() => {
    const map = new Map<string, { count: number; subs: Map<string, number> }>();
    for (const it of data) {
      const [g, sg] = taxonomyKeys(it, taxonomy);
      const entry = map.get(g) || { count: 0, subs: new Map<string, number>() };
      entry.count++;
      if (sg) entry.subs.set(sg, (entry.subs.get(sg) || 0) + 1);
      map.set(g, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([g, { count, subs }]) => ({
        group: g,
        count,
        subs: Array.from(subs.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, c]) => ({ name, count: c })),
      }));
  }, [data, taxonomy]);

  const toggleKey = (key: string) => {
    setHiddenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleExpand = (g: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  };


  const handlePick = async (index: number) => {
    const item = data[index];
    if (!item) return;
    onSound?.(item.metadata.name || '');
  };

  const selectedIndex = useMemo(() => {
    if (!selectedItem) return null;
    const idx = data.findIndex(it => it.metadata?.name === selectedItem.metadata?.name);
    return idx === -1 ? null : idx;
  }, [selectedItem, data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
        <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)' }} onClick={() => setShowGraphOptions(!showGraphOptions)}>⚙ Axes</button>
      </div>
      <section className="main-view glass-panel" style={{ margin: 0, padding: 0, overflow: 'hidden', flex: 1, position: 'relative' }}>
        {glOk ? (
          <WebGLBoundary fallback={<WebGLUnavailable />}>
            <Suspense fallback={<div style={{ color: 'white', padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Initializing 3D Engine...</div>}>
              <SampleCloud
                data={data} xAxis={xAxis} yAxis={yAxis} zAxis={zAxis}
                sizeAxis={sizeAxis} colorBy={colorBy} shapeBy={shapeBy} hiddenGroups={hiddenGroups}
                selectedIndex={selectedIndex} onPick={handlePick} showAxes={showAxes}
                playing={playing}
              />
            </Suspense>
          </WebGLBoundary>
        ) : (
          <WebGLUnavailable />
        )}

        {/* Axes Menu */}
        {showGraphOptions && (
          <div className="glass-panel" style={{
            position: 'absolute', top: '40px', right: '10px', width: '260px', zIndex: 20, padding: '1rem',
            background: 'rgba(11,14,20,0.95)', border: '1px solid var(--border-color)', borderRadius: '6px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <GraphOptionsMenu
              xAxis={xAxis} setXAxis={setXAxis} yAxis={yAxis} setYAxis={setYAxis}
              zAxis={zAxis} setZAxis={setZAxis} sizeAxis={sizeAxis} setSizeAxis={setSizeAxis}
              colorBy={colorBy} setColorBy={setColorBy} showAxes={showAxes} setShowAxes={setShowAxes}
              audioFilesLength={isTauri() ? 1 : audioFiles.length}
            />
          </div>
        )}



        {/* Overlay Toggles (Top Right) */}
        <div style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 20, display: 'flex', gap: '0.5rem' }}>
          <button className={`btn ${showGroups ? 'primary' : 'secondary'}`} onClick={() => { setShowGroups(!showGroups); setShowGraphOptions(false); setShowShapes(false); }}>📁 Groups</button>
          <button className={`btn ${showShapes ? 'primary' : 'secondary'}`} onClick={() => { setShowShapes(!showShapes); setShowGraphOptions(false); setShowGroups(false); }}>🔺 Shapes</button>
          <button className={`btn ${showGraphOptions ? 'primary' : 'secondary'}`} onClick={() => { setShowGraphOptions(!showGraphOptions); setShowGroups(false); setShowShapes(false); }}>⚙ Graph Options</button>
        </div>

        {/* Graph Options Overlay */}
        {showGraphOptions && (
          <GraphOptionsMenu
            xAxis={xAxis} setXAxis={setXAxis} yAxis={yAxis} setYAxis={setYAxis}
            zAxis={zAxis} setZAxis={setZAxis} sizeAxis={sizeAxis} setSizeAxis={setSizeAxis}
            colorBy={colorBy} setColorBy={setColorBy} showAxes={showAxes} setShowAxes={setShowAxes}
            audioFilesLength={isTauri() ? 1 : audioFiles.length}
          />
        )}

        {/* Groups Overlay */}
        {showGroups && (
          <GroupsMenu
            groupTree={groupTree} taxonomy={taxonomy} hiddenGroups={hiddenGroups} setHiddenGroups={setHiddenGroups}
            expanded={expanded} setExpanded={setExpanded} toggleKey={toggleKey} toggleExpand={toggleExpand}
          />
        )}

        {/* Shapes Overlay */}
        {showShapes && (
          <ShapesMenu shapeBy={shapeBy} setShapeBy={setShapeBy} />
        )}
      </section>
    </div>
  );
}
