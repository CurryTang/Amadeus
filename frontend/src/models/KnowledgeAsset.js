class KnowledgeAsset {
  constructor({
    id = null,
    assetType = 'insight',
    title = '',
    summary = '',
    bodyMd = '',
    source = {},
    file = {},
    externalDocumentId = null,
    tags = [],
    metadata = {},
    createdAt = '',
    updatedAt = '',
  } = {}) {
    this.id = Number.isFinite(Number(id)) ? Number(id) : null;
    this.assetType = String(assetType || 'insight');
    this.title = String(title || '');
    this.summary = String(summary || '');
    this.bodyMd = typeof bodyMd === 'string' ? bodyMd : '';
    this.source = source && typeof source === 'object' ? source : {};
    this.file = file && typeof file === 'object' ? file : {};
    this.externalDocumentId = Number.isFinite(Number(externalDocumentId))
      ? Number(externalDocumentId)
      : null;
    this.tags = Array.isArray(tags) ? tags : [];
    this.metadata = metadata && typeof metadata === 'object' ? metadata : {};
    this.createdAt = String(createdAt || '');
    this.updatedAt = String(updatedAt || '');
  }

  get subtitle() {
    const provider = String(this.source?.provider || '').trim();
    if (provider) return `${this.assetType} · ${provider}`;
    return this.assetType;
  }

  static fromApi(raw = {}) {
    return new KnowledgeAsset({
      id: raw.id,
      assetType: raw.assetType,
      title: raw.title,
      summary: raw.summary,
      bodyMd: raw.bodyMd,
      source: raw.source,
      file: raw.file,
      externalDocumentId: raw.externalDocumentId,
      tags: raw.tags,
      metadata: raw.metadata,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}

export default KnowledgeAsset;
