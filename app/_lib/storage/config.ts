export function getAudioStorageBucket() {
  return process.env.STORAGE_BUCKET || "telehealth_audio";
}

export function getDocumentsStorageBucket() {
  return process.env.DOCUMENTS_STORAGE_BUCKET || "tele-med-docs";
}
