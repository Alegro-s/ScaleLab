
const d = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE || 'masshtablab');

d.createCollection('events');
d.events.createIndex({ session_id: 1, ts: -1 });
d.events.createIndex({ kind: 1 });

d.createCollection('report_payloads');
d.report_payloads.createIndex({ session_id: 1, number: -1 }, { unique: true });

d.createCollection('segmentations');
d.segmentations.createIndex({ sample_id: 1, ts: -1 });

d.createCollection('ui_state');
d.ui_state.createIndex({ user_id: 1 }, { unique: true });
