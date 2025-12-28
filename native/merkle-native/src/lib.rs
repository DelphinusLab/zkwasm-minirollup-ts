use napi::bindgen_prelude::*;
use napi_derive::napi;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use zkwasm_host_circuits::constants::MERKLE_DEPTH;
use zkwasm_host_circuits::host::datahash::{DataHashRecord, MongoDataHash};
use zkwasm_host_circuits::host::db::{RocksDB, TreeDB};
use zkwasm_host_circuits::host::merkle::MerkleTree;
use zkwasm_host_circuits::host::mongomerkle::{MerkleRecord, MongoMerkle};

static DB: OnceLock<RocksDB> = OnceLock::new();
static DB_URI: OnceLock<String> = OnceLock::new();
static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Mutex<OverlayState>>>>> = OnceLock::new();
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct OverlayState {
  merkle: HashMap<[u8; 32], Option<MerkleRecord>>,
  data: HashMap<[u8; 32], Option<DataHashRecord>>,
}

#[derive(Clone)]
struct SessionDB {
  base: RocksDB,
  overlay: Arc<Mutex<OverlayState>>,
}

impl TreeDB for SessionDB {
  fn get_merkle_record(&self, hash: &[u8; 32]) -> anyhow::Result<Option<MerkleRecord>> {
    let guard = self
      .overlay
      .lock()
      .map_err(|_| anyhow::anyhow!("overlay lock poisoned"))?;
    if let Some(record) = guard.merkle.get(hash) {
      return Ok(record.clone());
    }
    drop(guard);
    self.base.get_merkle_record(hash)
  }

  fn set_merkle_record(&mut self, record: MerkleRecord) -> anyhow::Result<()> {
    let mut guard = self
      .overlay
      .lock()
      .map_err(|_| anyhow::anyhow!("overlay lock poisoned"))?;
    guard.merkle.insert(record.hash, Some(record));
    Ok(())
  }

  fn set_merkle_records(&mut self, records: &Vec<MerkleRecord>) -> anyhow::Result<()> {
    let mut guard = self
      .overlay
      .lock()
      .map_err(|_| anyhow::anyhow!("overlay lock poisoned"))?;
    for record in records {
      guard.merkle.insert(record.hash, Some(record.clone()));
    }
    Ok(())
  }

  fn get_data_record(&self, hash: &[u8; 32]) -> anyhow::Result<Option<DataHashRecord>> {
    let guard = self
      .overlay
      .lock()
      .map_err(|_| anyhow::anyhow!("overlay lock poisoned"))?;
    if let Some(record) = guard.data.get(hash) {
      return Ok(record.clone());
    }
    drop(guard);
    self.base.get_data_record(hash)
  }

  fn set_data_record(&mut self, record: DataHashRecord) -> anyhow::Result<()> {
    let mut guard = self
      .overlay
      .lock()
      .map_err(|_| anyhow::anyhow!("overlay lock poisoned"))?;
    guard.data.insert(record.hash, Some(record));
    Ok(())
  }

  fn start_record(&mut self, _record_db: RocksDB) -> anyhow::Result<()> {
    Err(anyhow::anyhow!("SessionDB does not support record"))
  }

  fn stop_record(&mut self) -> anyhow::Result<RocksDB> {
    Err(anyhow::anyhow!("SessionDB does not support record"))
  }

  fn is_recording(&self) -> bool {
    false
  }
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<Mutex<OverlayState>>>> {
  SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn to_bytes32(buf: &[u8]) -> napi::Result<[u8; 32]> {
  if buf.len() != 32 {
    return Err(napi::Error::new(
      Status::InvalidArg,
      format!("expected 32 bytes, got {}", buf.len()),
    ));
  }
  let mut out = [0u8; 32];
  out.copy_from_slice(buf);
  Ok(out)
}

fn parse_u64_decimal(value: &str, name: &str) -> napi::Result<u64> {
  value.parse::<u64>().map_err(|_| {
    napi::Error::new(
      Status::InvalidArg,
      format!("invalid {name} u64 decimal: {value}"),
    )
  })
}

fn get_db(session: Option<String>) -> napi::Result<std::rc::Rc<std::cell::RefCell<dyn TreeDB>>> {
  let db = DB
    .get()
    .ok_or_else(|| napi::Error::new(Status::GenericFailure, "merkle db not opened"))?
    .clone();
  if let Some(session) = session {
    let overlay = sessions()
      .lock()
      .map_err(|_| napi::Error::new(Status::GenericFailure, "sessions lock poisoned"))?
      .get(&session)
      .cloned();
    let Some(overlay) = overlay else {
      return Err(napi::Error::new(
        Status::InvalidArg,
        format!("unknown session: {session}"),
      ));
    };
    let db = SessionDB { base: db, overlay };
    Ok(std::rc::Rc::new(std::cell::RefCell::new(db)))
  } else {
    Ok(std::rc::Rc::new(std::cell::RefCell::new(db)))
  }
}

fn get_mt(
  root: [u8; 32],
  session: Option<String>,
) -> napi::Result<MongoMerkle<MERKLE_DEPTH>> {
  let db = get_db(session)?;
  Ok(MongoMerkle::<MERKLE_DEPTH>::construct([0; 32], root, Some(db)))
}

#[napi]
pub fn open(uri: String) -> napi::Result<()> {
  if let Some(existing) = DB_URI.get() {
    if existing != &uri {
      return Err(napi::Error::new(
        Status::InvalidArg,
        format!("merkle db already opened at {existing}, refusing {uri}"),
      ));
    }
  }
  if DB.get().is_none() {
    let db = RocksDB::new(&uri).map_err(|e| {
      napi::Error::new(
        Status::GenericFailure,
        format!("open merkle db failed: {e}"),
      )
    })?;
    let _ = DB.set(db);
  }
  let _ = DB_URI.set(uri);
  Ok(())
}

#[napi]
pub fn ping() -> bool {
  true
}

#[napi]
pub fn begin_session() -> String {
  let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
  let session = format!("s{id}");
  let overlay = Arc::new(Mutex::new(OverlayState::default()));
  if let Ok(mut guard) = sessions().lock() {
    guard.insert(session.clone(), overlay);
  }
  session
}

#[napi]
pub fn drop_session(session: String) -> bool {
  sessions()
    .lock()
    .ok()
    .and_then(|mut guard| guard.remove(&session))
    .is_some()
}

#[napi]
pub fn reset_session(session: String) -> napi::Result<bool> {
  let overlay = sessions()
    .lock()
    .map_err(|_| napi::Error::new(Status::GenericFailure, "sessions lock poisoned"))?
    .get(&session)
    .cloned();
  let Some(overlay) = overlay else {
    return Err(napi::Error::new(
      Status::InvalidArg,
      format!("unknown session: {session}"),
    ));
  };
  let mut guard = overlay
    .lock()
    .map_err(|_| napi::Error::new(Status::GenericFailure, "overlay lock poisoned"))?;
  guard.merkle.clear();
  guard.data.clear();
  Ok(true)
}

#[napi(object)]
pub struct CommitSessionResponse {
  pub merkle_records: u32,
  pub data_records: u32,
}

#[napi]
pub fn commit_session(session: String) -> napi::Result<CommitSessionResponse> {
  let overlay = sessions()
    .lock()
    .map_err(|_| napi::Error::new(Status::GenericFailure, "sessions lock poisoned"))?
    .get(&session)
    .cloned();
  let Some(overlay) = overlay else {
    return Err(napi::Error::new(
      Status::InvalidArg,
      format!("unknown session: {session}"),
    ));
  };

  let (merkle, data) = {
    let mut guard = overlay
      .lock()
      .map_err(|_| napi::Error::new(Status::GenericFailure, "overlay lock poisoned"))?;
    let merkle = std::mem::take(&mut guard.merkle);
    let data = std::mem::take(&mut guard.data);
    (merkle, data)
  };

  let merkle_records: Vec<MerkleRecord> = merkle.into_values().flatten().collect();
  let data_records: Vec<DataHashRecord> = data.into_values().flatten().collect();

  let mut base = DB
    .get()
    .ok_or_else(|| napi::Error::new(Status::GenericFailure, "merkle db not opened"))?
    .clone();
  base
    .set_merkle_records(&merkle_records)
    .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
  for record in data_records.iter().cloned() {
    base
      .set_data_record(record)
      .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
  }

  Ok(CommitSessionResponse {
    merkle_records: merkle_records.len() as u32,
    data_records: data_records.len() as u32,
  })
}

#[napi]
pub fn update_leaf(
  root: Buffer,
  index: String,
  data: Buffer,
  session: Option<String>,
) -> napi::Result<Buffer> {
  let root = to_bytes32(&root)?;
  let index = parse_u64_decimal(&index, "index")?;
  let data = to_bytes32(&data)?;
  let mut mt = get_mt(root, session)?;
  mt.update_leaf_data_with_proof(index, &data.to_vec())
    .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
  Ok(Buffer::from(mt.get_root_hash().to_vec()))
}

#[napi]
pub fn get_leaf(root: Buffer, index: String, session: Option<String>) -> napi::Result<Buffer> {
  let root = to_bytes32(&root)?;
  let index = parse_u64_decimal(&index, "index")?;
  let mt = get_mt(root, session)?;
  let (leaf, _) = mt
    .get_leaf_with_proof(index)
    .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
  Ok(Buffer::from(leaf.data.unwrap_or([0u8; 32]).to_vec()))
}

#[napi]
pub fn update_record(
  hash: Buffer,
  data: Vec<String>,
  session: Option<String>,
) -> napi::Result<()> {
  let hash = to_bytes32(&hash)?;
  let db = get_db(session)?;
  let mut mongo_datahash = MongoDataHash::construct([0; 32], Some(db));
  let mut bytes = Vec::with_capacity(data.len() * 8);
  for limb in data {
    bytes.extend_from_slice(&parse_u64_decimal(&limb, "data")?.to_le_bytes());
  }
  mongo_datahash
    .update_record(DataHashRecord { hash, data: bytes })
    .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
  Ok(())
}

#[napi]
pub fn get_record(hash: Buffer, session: Option<String>) -> napi::Result<Vec<String>> {
  let hash = to_bytes32(&hash)?;
  let db = get_db(session)?;
  let mongo_datahash = MongoDataHash::construct([0; 32], Some(db));
  let record = mongo_datahash
    .get_record(&hash)
    .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
  let out = record.map_or(Vec::new(), |r| {
    r.data
      .chunks_exact(8)
      .map(|x| u64::from_le_bytes(x.try_into().unwrap()).to_string())
      .collect()
  });
  Ok(out)
}

#[napi(object)]
pub struct ApplyLeafWrite {
  pub index: String,
  pub data: Buffer,
}

#[napi(object)]
pub struct ApplyRecordUpdate {
  pub hash: Buffer,
  pub data: Vec<String>,
}

#[napi(object)]
pub struct ApplyTxTrace {
  pub writes: Vec<ApplyLeafWrite>,
  #[napi(js_name = "updateRecords")]
  pub update_records: Vec<ApplyRecordUpdate>,
}

#[napi]
pub fn apply_txs(
  root: Buffer,
  txs: Vec<ApplyTxTrace>,
  session: Option<String>,
) -> napi::Result<Vec<Buffer>> {
  let root = to_bytes32(&root)?;
  let db = get_db(session)?;
  let mut mongo_datahash = MongoDataHash::construct([0; 32], Some(db.clone()));
  let mut mt = MongoMerkle::<MERKLE_DEPTH>::construct([0; 32], root, Some(db));

  let mut roots: Vec<Buffer> = Vec::with_capacity(txs.len());
  for tx in txs {
    for rec in tx.update_records {
      let hash = to_bytes32(&rec.hash)?;
      let mut bytes = Vec::with_capacity(rec.data.len() * 8);
      for limb in rec.data {
        bytes.extend_from_slice(&parse_u64_decimal(&limb, "data")?.to_le_bytes());
      }
      mongo_datahash
        .update_record(DataHashRecord { hash, data: bytes })
        .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
    }

    for w in tx.writes {
      let index = parse_u64_decimal(&w.index, "index")?;
      let data = to_bytes32(&w.data)?;
      mt.update_leaf_data_with_proof(index, &data.to_vec())
        .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
    }

    roots.push(Buffer::from(mt.get_root_hash().to_vec()));
  }

  Ok(roots)
}

#[napi]
pub fn apply_txs_final(
  root: Buffer,
  txs: Vec<ApplyTxTrace>,
  session: Option<String>,
) -> napi::Result<Buffer> {
  let root = to_bytes32(&root)?;
  let db = get_db(session)?;
  let mut mongo_datahash = MongoDataHash::construct([0; 32], Some(db.clone()));
  let mut mt = MongoMerkle::<MERKLE_DEPTH>::construct([0; 32], root, Some(db));

  for tx in txs {
    for rec in tx.update_records {
      let hash = to_bytes32(&rec.hash)?;
      let mut bytes = Vec::with_capacity(rec.data.len() * 8);
      for limb in rec.data {
        bytes.extend_from_slice(&parse_u64_decimal(&limb, "data")?.to_le_bytes());
      }
      mongo_datahash
        .update_record(DataHashRecord { hash, data: bytes })
        .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
    }

    for w in tx.writes {
      let index = parse_u64_decimal(&w.index, "index")?;
      let data = to_bytes32(&w.data)?;
      mt.update_leaf_data_with_proof(index, &data.to_vec())
        .map_err(|e| napi::Error::new(Status::GenericFailure, format!("{e}")))?;
    }
  }

  Ok(Buffer::from(mt.get_root_hash().to_vec()))
}
