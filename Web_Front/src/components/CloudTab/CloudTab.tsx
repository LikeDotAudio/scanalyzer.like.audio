import { Suspense, useState, useEffect, useMemo } from 'react';
import SampleCloud from '../SampleCloud';
import { resolveAudioUrl, isTauri } from '../../audioLinking';
import ScopeBar from '../ScopeBar';
import GraphOptionsMenu from './GraphOptionsMenu';
import GroupsMenu from './GroupsMenu'
import { taxonomyKeys, matchesScope, ucsSubColor } from '../../groupColors';
import ShapesMenu from './ShapesMenu';
import CircularWavePlayer from '../CircularWavePlayer';
import { WebGLBoundary, webglAvailable } from './WebGLBoundary';

interface CloudTabProps {
  analysisResult: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
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

export default function CloudTab({ analysisResult, audioFiles, onSound, onExamine, onExtract }: CloudTabProps) {
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
  const [scopeGroup, setScopeGroup] = useState<string | null>(null);
  const [scopeSub, setScopeSub] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  // UCS is king. The 3D view speaks one taxonomy, and this is it — no per-record role,
  // no switch, no colour-mode-derived second axis of meaning.
  const taxonomy = 'UCS' as const;

  useEffect(() => {
    setScopeGroup(null);
    setScopeSub(null);
    setFilterText('');
  }, [analysisResult]);

  const data = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return analysisResult.filter(it => {
      if (!matchesScope(it, scopeGroup, scopeSub)) return false;
      if (q && !`${it.metadata?.name || ''} ${it.classification?.group || ''} ${it.classification?.subgroup || ''} ${it.ucs?.category || ''} ${it.ucs?.subcategory || ''} ${it.classification?.timbre || ''} ${it.musicality?.root_note_name || ''} ${it.classification?.reason?.[0] || ''}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, scopeGroup, scopeSub, filterText]);

  useEffect(() => {
    localStorage.setItem(PREF + 'xAxis', xAxis);
    localStorage.setItem(PREF + 'yAxis', yAxis);
    localStorage.setItem(PREF + 'zAxis', zAxis);
    localStorage.setItem(PREF + 'sizeAxis', sizeAxis);
    localStorage.setItem(PREF + 'colorBy', colorBy);
    localStorage.setItem(PREF + 'shapeBy', shapeBy);
  }, [xAxis, yAxis, zAxis, sizeAxis, colorBy, shapeBy]);
  const [showAxes, setShowAxes] = useState(true);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedIndex(null);
  }, [scopeGroup, scopeSub]);

  const [showGraphOptions, setShowGraphOptions] = useState(() => window.innerWidth > 768);
  const [showGroups, setShowGroups] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  const [playMsg, setPlayMsg] = useState<string>('');
  // Drives the selected point's pulse in the 3D cloud — true only while audio sounds.
  const [isPlaying, setIsPlaying] = useState(false);
  // Resolved audio URL of the picked sample; handed to the corner CircularWavePlayer,
  // which owns decode + transport (there is no <audio> element in this tab any more).
  const [selectedSrc, setSelectedSrc] = useState<string | null>(null);
  // Checked once: if WebGL can't start (GPU disabled / sandboxed webview / headless), the
  // 3D view shows a message instead of throwing an uncaught three.js error.
  const [glOk] = useState(webglAvailable);

  // Distinct groups → their subgroups, with per-group and per-subgroup file
  // counts, for the nested legend.
  // Which taxonomy the cloud is showing. Derived from the colour choice, so the
  // legend and the hide/show filters always describe what you are actually
  // looking at — colour by UCS and the tree becomes UCS category -> subcategory.
  const groupTree = useMemo(() => {
    const map = new Map<string, { count: number; subs: Map<string, number> }>();
    for (const it of analysisResult) {
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
  }, [analysisResult, taxonomy]);

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
    setSelectedIndex(index);
    const item = data[index];
    if (!item) return;
    onSound?.(item.metadata.name || '');
    if (!isTauri() && audioFiles.length === 0) { setSelectedSrc(null); setPlayMsg('No audio linked — click "Load Sounds" in the header.'); return; }
    const src = await resolveAudioUrl(audioFiles, item);
    if (!src) {
      setSelectedSrc(null);
      if (!isTauri()) {
          setPlayMsg(`Click 'Load Sounds' above to pick the ${item.metadata.folder} directory and enable playback.`);
      } else {
          setPlayMsg(`File not found: ${item.metadata.path}`);
      }
      return;
    }
    // The corner player takes it from here: it points its audio at src, plays (the pick
    // is the user gesture), decodes the ring, and reports play/stop via onPlayingChange.
    setPlayMsg('');
    setSelectedSrc(src);
  };

  const selected = selectedIndex != null ? data[selectedIndex] : null;
  const selectedColor = selected ? ucsSubColor(selected.ucs?.category || '', (selected.ucs?.subcategory || '').trim()) : '#f4902c';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>
      <div style={{ padding: '0.5rem 1rem', background: '#0d1017', borderBottom: '1px solid var(--border-color)', zIndex: 10 }}>
          <ScopeBar 
            analysisResult={analysisResult} group={scopeGroup} sub={scopeSub} setGroup={setScopeGroup} setSub={setScopeSub} 
            filterText={filterText} setFilterText={setFilterText} taxonomy={taxonomy}
            rightContent={
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{data.length} / {analysisResult.length} samples</span>
            }
          />
      </div>
      {/* 3D WebGL Canvas Area */}
      <section className="main-view glass-panel" style={{ margin: 0, padding: 0, overflow: 'hidden', flex: 1, position: 'relative' }}>
        <Suspense fallback={<div style={{ color: 'white', padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Initializing 3D Engine...</div>}>
          <SampleCloud
            data={data} xAxis={xAxis} yAxis={yAxis} zAxis={zAxis}
            sizeAxis={sizeAxis} colorBy={colorBy} shapeBy={shapeBy} hiddenGroups={hiddenGroups}
            selectedIndex={selectedIndex} onPick={handlePick} showAxes={showAxes}
            playing={isPlaying}
          />
        </Suspense>
        {/* Selected sample readout (Top Left) */}
        {selected && (
          <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 10, background: 'rgba(0,0,0,0.65)', padding: '0.6rem 0.9rem', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '340px' }}>
            <div style={{ color: '#FCD34D', fontSize: '0.85rem', marginBottom: '0.2rem' }}>{selected.metadata?.name}</div>
            <div className="text-secondary" style={{ fontSize: '0.75rem' }}>{selected.classification?.group}{selected.classification?.subgroup ? ` / ${selected.classification?.subgroup}` : ''} · {selected.classification?.timbre} · {selected.metadata?.length_seconds?.toFixed(2)}s</div>
            {(onExamine || onExtract) && (
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.45rem' }}>
                {onExamine && <button className="btn secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem' }} onClick={() => selected.metadata?.name && onExamine(selected.metadata.name)} title="Open this file in the Examiner">🔍 Examine</button>}
                {onExtract && <button className="btn secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem' }} onClick={() => selected.metadata?.name && onExtract(selected.metadata.name)} title="Open this file in the Extractor">✂ Extract</button>}
              </div>
            )}
            {playMsg && <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: '#f59e0b' }}>{playMsg}</div>}
          </div>
        )}

        {/* Bottom Right: the circular wave player once a sample is picked, otherwise the hint. */}
        {selectedSrc ? (
          <div style={{ position: 'absolute', bottom: '1.25rem', right: '1.25rem', zIndex: 15 }}>
            <CircularWavePlayer
              src={selectedSrc}
              name={selected?.metadata?.name || ''}
              color={selectedColor}
              size={180}
              onPlayingChange={setIsPlaying}
            />
          </div>
        ) : (
          <div className="hide-on-mobile" style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 10 }}>
               <p className="text-secondary" style={{ background: 'rgba(0,0,0,0.6)', padding: '0.6rem 1rem', border: '1px solid rgba(255,255,255,0.1)', margin: 0 }}>
                 🖱️ Click a dot to hear it • Drag: orbit • Scroll: zoom
               </p>
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
