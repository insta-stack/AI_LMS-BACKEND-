const express = require('express');
const router = express.Router();
const sql = require('../../db');
const { ObjectId } = require('mongodb');

// Get all store items
router.get('/items', async (req, res) => {
  try {
    console.log('=== GET STORE ITEMS REQUEST ===');
    const items = await sql.find('store');
    console.log(`Found ${items.length} store items`);
    res.json(items);
  } catch (error) {
    console.error('Error fetching store items:', error);
    res.status(500).json({ error: 'Failed to fetch store items', details: error.message });
  }
});

// Add new store item
router.post('/items', async (req, res) => {
  try {
    console.log('=== ADD STORE ITEM REQUEST ===');
    console.log('Request body:', req.body);
    
    const { name, category, price, stock, description, image } = req.body;
    
    if (!name || !category || !price || stock === undefined) {
      console.log('Validation failed - missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newItem = {
      name,
      category,
      price: parseFloat(price),
      stock: parseInt(stock),
      description: description || '',
      image: image || '📦',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    console.log('Inserting new item:', newItem);
    const result = await sql.insertOne('store', newItem);
    console.log('Insert result:', result);
    
    res.status(201).json({ 
      message: 'Store item added successfully', 
      itemId: result.insertedId 
    });
  } catch (error) {
    console.error('Error adding store item:', error);
    res.status(500).json({ error: 'Failed to add store item', details: error.message });
  }
});

// Update store item
router.put('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, price, stock, description, image } = req.body;
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name) updateData.name = name;
    if (category) updateData.category = category;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;

    const result = await sql.updateOne('store', 
      { _id: new ObjectId(id) }, 
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Store item not found' });
    }

    res.json({ message: 'Store item updated successfully' });
  } catch (error) {
    console.error('Error updating store item:', error);
    res.status(500).json({ error: 'Failed to update store item' });
  }
});

// Delete store item
router.delete('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await sql.deleteOne('store', 
      { _id: new ObjectId(id) }
    );

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Store item not found' });
    }

    res.json({ message: 'Store item deleted successfully' });
  } catch (error) {
    console.error('Error deleting store item:', error);
    res.status(500).json({ error: 'Failed to delete store item' });
  }
});

// Get categories
router.get('/categories', async (req, res) => {
  try {
    const items = await sql.find('store');
    const categories = [...new Set(items.map(item => item.category))];
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

module.exports = router;