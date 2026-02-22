const express = require('express');
const router = express.Router();
const tagService = require('../services/tag.service');

// GET /api/tags - List all tags
router.get('/', async (req, res) => {
  try {
    const userId = req.userId || 'czk';
    const tags = await tagService.getTags(userId);
    res.json({ tags, colors: tagService.TAG_COLORS });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// GET /api/tags/:id - Get single tag
router.get('/:id', async (req, res) => {
  try {
    const tag = await tagService.getTagById(parseInt(req.params.id, 10));

    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json(tag);
  } catch (error) {
    console.error('Error fetching tag:', error);
    res.status(500).json({ error: 'Failed to fetch tag' });
  }
});

// POST /api/tags - Create new tag
router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const tag = await tagService.createTag({
      name,
      color,
      userId: req.userId || 'czk',
    });

    res.status(201).json(tag);
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// POST /api/tags/bulk - Create multiple tags
router.post('/bulk', async (req, res) => {
  try {
    const { names } = req.body;

    if (!names || !Array.isArray(names)) {
      return res.status(400).json({ error: 'Tag names array is required' });
    }

    const tags = await tagService.createTagsIfNotExist(
      names,
      req.userId || 'czk'
    );

    res.status(201).json({ tags });
  } catch (error) {
    console.error('Error creating tags:', error);
    res.status(500).json({ error: 'Failed to create tags' });
  }
});

// PUT /api/tags/:id - Update tag
router.put('/:id', async (req, res) => {
  try {
    const tag = await tagService.updateTag(parseInt(req.params.id, 10), req.body);

    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json(tag);
  } catch (error) {
    console.error('Error updating tag:', error);
    res.status(500).json({ error: 'Failed to update tag' });
  }
});

// DELETE /api/tags/:id - Delete tag
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await tagService.deleteTag(parseInt(req.params.id, 10));

    if (!deleted) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

module.exports = router;
