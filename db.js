// db.js - MongoDB Configuration

const { MongoClient } = require('mongodb');
require('dotenv').config();

// MongoDB connection configuration
const {
  MONGODB_URI = 'mongodb://localhost:27017',
  DB_NAME = 'AILMS',
  NODE_ENV
} = process.env;

let client = null;
let db = null;

// Initialize MongoDB connection
async function connectToMongo() {
  try {
    if (!client) {
      client = new MongoClient(MONGODB_URI);
      await client.connect();
      db = client.db(DB_NAME);
      console.log('✅ MongoDB connected successfully');
    }
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    throw error;
  }
}

// MongoDB interface with native operations
const sql = {
  // Expose the connection function
  connectToMongo,
  
  // Helper method to insert a document
  async insertOne(collectionName, document) {
    const db = await connectToMongo();
    const collection = db.collection(collectionName);
    return await collection.insertOne(document);
  },
  
  // Helper method to update a document
  async updateOne(collectionName, filter, update) {
    const db = await connectToMongo();
    const collection = db.collection(collectionName);
    return await collection.updateOne(filter, update);
  },
  
  // Helper method to delete a document
  async deleteOne(collectionName, filter) {
    const db = await connectToMongo();
    const collection = db.collection(collectionName);
    return await collection.deleteOne(filter);
  },
  
  // Helper method to find one document
  async findOne(collectionName, filter) {
    const db = await connectToMongo();
    const collection = db.collection(collectionName);
    return await collection.findOne(filter);
  },
  // Find documents in a collection
  async find(collectionName, query = {}, options = {}) {
    const db = await connectToMongo();
    console.log(`=== MongoDB Find Operation ===`);
    console.log(`Collection: ${collectionName}`);
    console.log(`Query:`, query);
    console.log(`Options:`, options);
    
    const collection = db.collection(collectionName);
    const cursor = collection.find(query, options);
    
    if (options.sort) {
      cursor.sort(options.sort);
    }
    
    const result = await cursor.toArray();
    console.log(`Result count: ${result.length}`);
    console.log(`Results:`, result);
    return result;
  },

  // Count documents in a collection
  async count(collectionName, query = {}) {
    const db = await connectToMongo();
    console.log(`=== MongoDB Count Operation ===`);
    console.log(`Collection: ${collectionName}`);
    console.log(`Query:`, query);
    
    const collection = db.collection(collectionName);
    const count = await collection.countDocuments(query);
    console.log(`Count result: ${count}`);
    return [{ count }];
  },

  // Template literal function for backward compatibility
  async query(strings, ...values) {
    console.log('=== MongoDB Template Query ===');
    console.log('Template strings:', strings);
    console.log('Template values:', values);
    
    // Handle connection test queries
    if (strings.join('').includes('SELECT NOW()') || strings.join('').includes('SELECT 1')) {
      return [{ current_time: new Date().toISOString(), message: 'Database connected!' }];
    }
    
    // Handle simple SELECT without FROM
    if (strings.join('').includes('SELECT') && !strings.join('').includes('FROM')) {
      return [{ connection_test: 1 }];
    }
    
    // Parse SQL-like template literal and convert to MongoDB operations
    const queryTemplate = strings.join('PLACEHOLDER');
    console.log('Query template:', queryTemplate);
    
    // Extract collection name (first template value)
    let valueIndex = 0;
    let collectionName = null;
    
    const fromMatch = queryTemplate.match(/FROM\s+PLACEHOLDER/i);
    if (fromMatch && valueIndex < values.length) {
      collectionName = values[valueIndex];
      valueIndex++;
    }
    
    if (!collectionName) {
      throw new Error('No collection specified in query');
    }
    
    // Handle COUNT queries
    if (queryTemplate.includes('COUNT(*)') || queryTemplate.includes('COUNT')) {
      const whereMatch = queryTemplate.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s*$)/i);
      let query = {};
      
      if (whereMatch && valueIndex < values.length) {
        const fieldMatch = whereMatch[1].match(/(\w+)\s*=\s*PLACEHOLDER/i);
        if (fieldMatch) {
          const field = fieldMatch[1];
          const value = values[valueIndex];
          query[field] = value;
        }
      }
      
      return await this.count(collectionName, query);
    }
    
    // Handle SELECT queries
    let projection = {};
    const selectMatch = queryTemplate.match(/SELECT\s+(.+?)\s+FROM/i);
    if (selectMatch) {
      const selectFields = selectMatch[1].trim();
      if (selectFields !== '*') {
        const fields = selectFields.split(',').map(f => f.trim());
        fields.forEach(field => {
          projection[field] = 1;
        });
      }
    }
    
    // Handle WHERE clause
    let query = {};
    const whereMatch = queryTemplate.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s*$)/i);
    if (whereMatch && valueIndex < values.length) {
      const fieldMatch = whereMatch[1].match(/(\w+)\s*=\s*PLACEHOLDER/i);
      if (fieldMatch) {
        const field = fieldMatch[1];
        const value = values[valueIndex];
        query[field] = value;
        valueIndex++;
      }
    }
    
    // Handle ORDER BY clause
    let sort = {};
    const orderByMatch = queryTemplate.match(/ORDER BY\s+(.+?)(?:\s*$)/i);
    if (orderByMatch) {
      const orderByFields = orderByMatch[1].split(',').map(f => f.trim());
      orderByFields.forEach(field => {
        sort[field] = 1; // Default to ascending
      });
    }
    
    const options = {};
    if (Object.keys(projection).length > 0) {
      options.projection = projection;
    }
    if (Object.keys(sort).length > 0) {
      options.sort = sort;
    }
    
    return await this.find(collectionName, query, options);
  },
  
  // Alias for query method to maintain compatibility
  async findTemplate(strings, ...values) {
    return this.query(strings, ...values);
  },
  
  // Test connection method
  async testConnection() {
    try {
      const db = await connectToMongo();
      const result = await db.admin().ping();
      console.log('✅ MongoDB connection test successful');
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection test failed:', error.message);
      return false;
    }
  },
  
  // Close connection method
  async close() {
    if (client) {
      await client.close();
      client = null;
      db = null;
    }
  }
};

// Create template literal function
const sqlTemplate = (strings, ...values) => {
  return sql.query(strings, ...values);
};

// Copy all methods to the template function
Object.assign(sqlTemplate, sql);

module.exports = sqlTemplate;

