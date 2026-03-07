'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const knowledgeGroupsService = require('../../services/knowledge-groups.service');
const knowledgeAssetsService = require('../../services/researchops/knowledge-assets.service');
const {
  buildKnowledgeGroupListPayload,
  buildKnowledgeGroupPayload,
} = require('../../services/researchops/knowledge-group-payload.service');
const { parseLimit, parseOffset, getUserId, sanitizeError, parseMaybeJson } = require('./shared');

const knowledgeAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get('/knowledge-groups', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 200);
    const offset = parseOffset(req.query.offset, 0, 100000);
    const q = String(req.query.q || '').trim();
    const result = await knowledgeGroupsService.listKnowledgeGroups(getUserId(req), {
      limit,
      offset,
      q,
    });
    return res.json(buildKnowledgeGroupListPayload({ items: result.items, limit, offset, q }));
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeGroups failed:', error);
    return res.status(500).json({ error: 'Failed to list knowledge groups' });
  }
});

router.post('/knowledge-groups', async (req, res) => {
  try {
    const group = await knowledgeGroupsService.createKnowledgeGroup(getUserId(req), req.body || {});
    return res.status(201).json(buildKnowledgeGroupPayload({ group }));
  } catch (error) {
    console.error('[ResearchOps] createKnowledgeGroup failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to create knowledge group') });
  }
});

router.patch('/knowledge-groups/:groupId', async (req, res) => {
  try {
    const group = await knowledgeGroupsService.updateKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      req.body || {}
    );
    if (!group) return res.status(404).json({ error: 'Knowledge group not found' });
    return res.json(buildKnowledgeGroupPayload({ group }));
  } catch (error) {
    console.error('[ResearchOps] updateKnowledgeGroup failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update knowledge group') });
  }
});

router.delete('/knowledge-groups/:groupId', async (req, res) => {
  try {
    await knowledgeGroupsService.deleteKnowledgeGroup(getUserId(req), req.params.groupId);
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] deleteKnowledgeGroup failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to delete knowledge group') });
  }
});

router.get('/knowledge-groups/:groupId/documents', async (req, res) => {
  try {
    const result = await knowledgeGroupsService.listKnowledgeGroupDocuments(
      getUserId(req),
      req.params.groupId,
      {
        limit: parseLimit(req.query.limit, 12, 100),
        offset: parseOffset(req.query.offset, 0, 100000),
        q: String(req.query.q || '').trim(),
      }
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeGroupDocuments failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list group documents') });
  }
});

router.post('/knowledge-groups/:groupId/documents', async (req, res) => {
  try {
    const docIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds : [];
    const result = await knowledgeGroupsService.addDocumentsToKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      docIds
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] addDocumentsToKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to add documents to group') });
  }
});

router.delete('/knowledge-groups/:groupId/documents/:documentId', async (req, res) => {
  try {
    await knowledgeGroupsService.removeDocumentFromKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      req.params.documentId
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] removeDocumentFromKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to remove document from group') });
  }
});

// Knowledge assets (insights/files/notes/reports + document-backed assets)
router.get('/knowledge/assets', async (req, res) => {
  try {
    const result = await knowledgeAssetsService.listKnowledgeAssets(getUserId(req), {
      limit: parseLimit(req.query.limit, 20, 200),
      offset: parseOffset(req.query.offset, 0, 100000),
      q: String(req.query.q || '').trim(),
      assetType: String(req.query.assetType || '').trim(),
      provider: String(req.query.provider || '').trim(),
      groupId: req.query.groupId ? Number(req.query.groupId) : null,
      includeBody: req.query.includeBody === 'true',
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeAssets failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list knowledge assets') });
  }
});

router.post('/knowledge/assets', async (req, res) => {
  try {
    const asset = await knowledgeAssetsService.createKnowledgeAsset(getUserId(req), req.body || {});
    return res.status(201).json({ asset });
  } catch (error) {
    console.error('[ResearchOps] createKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to create knowledge asset') });
  }
});

router.post('/knowledge/assets/upload', knowledgeAssetUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const tagsParsed = parseMaybeJson(req.body?.tags, []);
    const metadataParsed = parseMaybeJson(req.body?.metadata, {});
    const sourceParsed = parseMaybeJson(req.body?.source, {});
    const groupIdsParsed = parseMaybeJson(req.body?.groupIds, []);
    const asset = await knowledgeAssetsService.createKnowledgeAssetFromUpload(
      getUserId(req),
      {
        assetType: req.body?.assetType,
        title: req.body?.title,
        summary: req.body?.summary,
        bodyMd: req.body?.bodyMd,
        source: sourceParsed || {},
        sourceProvider: req.body?.sourceProvider,
        sourceSessionId: req.body?.sourceSessionId,
        sourceMessageId: req.body?.sourceMessageId,
        sourceUrl: req.body?.sourceUrl,
        tags: Array.isArray(tagsParsed) ? tagsParsed : [],
        metadata: metadataParsed && typeof metadataParsed === 'object' ? metadataParsed : {},
        externalDocumentId: req.body?.externalDocumentId,
        groupIds: Array.isArray(groupIdsParsed) ? groupIdsParsed : [],
      },
      req.file
    );
    return res.status(201).json({ asset });
  } catch (error) {
    console.error('[ResearchOps] uploadKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to upload knowledge asset') });
  }
});

router.get('/knowledge/assets/:assetId', async (req, res) => {
  try {
    const asset = await knowledgeAssetsService.getKnowledgeAsset(getUserId(req), req.params.assetId, {
      includeBody: true,
    });
    if (!asset) return res.status(404).json({ error: 'Knowledge asset not found' });
    return res.json({ asset });
  } catch (error) {
    console.error('[ResearchOps] getKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch knowledge asset') });
  }
});

router.patch('/knowledge/assets/:assetId', async (req, res) => {
  try {
    const asset = await knowledgeAssetsService.updateKnowledgeAsset(getUserId(req), req.params.assetId, req.body || {});
    if (!asset) return res.status(404).json({ error: 'Knowledge asset not found' });
    return res.json({ asset });
  } catch (error) {
    console.error('[ResearchOps] updateKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update knowledge asset') });
  }
});

router.delete('/knowledge/assets/:assetId', async (req, res) => {
  try {
    const deleted = await knowledgeAssetsService.deleteKnowledgeAsset(getUserId(req), req.params.assetId);
    if (!deleted) return res.status(404).json({ error: 'Knowledge asset not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] deleteKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to delete knowledge asset') });
  }
});

router.get('/knowledge/groups/:groupId/assets', async (req, res) => {
  try {
    const result = await knowledgeAssetsService.listKnowledgeGroupAssets(
      getUserId(req),
      req.params.groupId,
      {
        limit: parseLimit(req.query.limit, 20, 200),
        offset: parseOffset(req.query.offset, 0, 100000),
        q: String(req.query.q || '').trim(),
        includeBody: req.query.includeBody === 'true',
      }
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeGroupAssets failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list group assets') });
  }
});

router.post('/knowledge/groups/:groupId/assets', async (req, res) => {
  try {
    const assetIds = Array.isArray(req.body?.assetIds) ? req.body.assetIds : [];
    const result = await knowledgeAssetsService.addAssetsToKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      assetIds
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] addAssetsToKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to add assets to group') });
  }
});

router.delete('/knowledge/groups/:groupId/assets/:assetId', async (req, res) => {
  try {
    await knowledgeAssetsService.removeAssetFromKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      req.params.assetId
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] removeAssetFromKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to remove asset from group') });
  }
});

module.exports = router;
