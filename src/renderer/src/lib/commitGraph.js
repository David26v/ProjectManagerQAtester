// Lane assignment for the Sourcetree-style commit graph. Input is `git log`
// order (newest first), each commit carrying its parent oids. Output gives
// every row a lane (column) plus the segments needed to draw it:
//
// - `incoming`  — lanes from the row above that terminate at this commit's
//                 dot (the commit itself + any branches merging into it)
// - `parentLanes` — lanes leaving the dot downward, one per parent (index 0
//                 continues this commit's own lane; extra parents of a merge
//                 either join a lane already waiting for that oid or open a
//                 new one)
// - `passThrough` — lanes that just continue vertically past this row
//
// The renderer draws, per row: verticals for passThrough, curves from each
// incoming lane's top into the dot, and curves from the dot out to each
// parent lane's bottom.

export function computeGraph(commits) {
  const lanes = []; // lanes[i] = the oid this lane is waiting to reach, or null (free)
  const rows = [];
  let maxLanes = 1;

  for (const c of commits) {
    const incoming = [];
    lanes.forEach((oid, i) => {
      if (oid === c.oid) incoming.push(i);
    });

    let lane;
    if (incoming.length === 0) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    } else {
      lane = Math.min(...incoming);
    }

    const passThrough = [];
    lanes.forEach((oid, i) => {
      if (oid !== null && !incoming.includes(i)) passThrough.push(i);
    });

    for (const i of incoming) if (i !== lane) lanes[i] = null;
    lanes[lane] = c.parents[0] || null;

    const parentLanes = c.parents.length ? [lane] : [];
    for (const p of c.parents.slice(1)) {
      let pi = lanes.indexOf(p);
      if (pi === -1) {
        pi = lanes.indexOf(null);
        // never steal the commit's own lane for a second parent
        if (pi === -1 || pi === lane) {
          pi = lanes.length;
          lanes.push(p);
        } else {
          lanes[pi] = p;
        }
      }
      parentLanes.push(pi);
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    const rowMax = Math.max(lane + 1, lanes.length, ...incoming.map((i) => i + 1), ...parentLanes.map((i) => i + 1), ...passThrough.map((i) => i + 1));
    if (rowMax > maxLanes) maxLanes = rowMax;

    rows.push({ oid: c.oid, lane, incoming, parentLanes, passThrough });
  }

  return { rows, maxLanes };
}

export const LANE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d'];

export function laneColor(index) {
  return LANE_COLORS[index % LANE_COLORS.length];
}
