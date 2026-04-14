const { MongoClient } = require('mongodb');
require('dotenv').config();

// MongoDB connection configuration
const {
  MONGODB_URI = 'mongodb://localhost:27017',
  DB_NAME = 'AILMS',
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

// Database helper functions
const database = {
  // Users
  async getUsers() {
    const db = await connectToMongo();
    return await db.collection('users').find({}).toArray();
  },

  async getUserById(id) {
    const db = await connectToMongo();
    return await db.collection('users').findOne({ _id: id });
  },

  async createUser(userData) {
    const db = await connectToMongo();
    const result = await db.collection('users').insertOne(userData);
    return { ...userData, _id: result.insertedId };
  },

  async updateUser(id, userData) {
    const db = await connectToMongo();
    await db.collection('users').updateOne(
      { _id: id },
      { $set: userData }
    );
    return { ...userData, _id: id };
  },

  async deleteUser(id) {
    const db = await connectToMongo();
    await db.collection('users').deleteOne({ _id: id });
    return { success: true };
  },

  // Leaves
  async getLeaves() {
    const db = await connectToMongo();
    const leaves = await db.collection('leaves').find({}).toArray();
    const userIds = leaves.map(leave => leave.user_id);
    const users = await db.collection('users')
      .find({ _id: { $in: userIds } })
      .toArray();
    
    return leaves.map(leave => ({
      ...leave,
      user: users.find(user => user._id.toString() === leave.user_id.toString())
    }));
  },

  async getLeavesByUserId(userId) {
    const db = await connectToMongo();
    return await db.collection('leaves')
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .toArray();
  },

  async createLeave(leaveData) {
    const db = await connectToMongo();
    const result = await db.collection('leaves').insertOne(leaveData);
    return { ...leaveData, _id: result.insertedId };
  },

  async updateLeaveStatus(id, status, adminNotes = null) {
    const db = await connectToMongo();
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };
    
    if (adminNotes) {
      updateData.admin_notes = adminNotes;
    }
    
    await db.collection('leaves').updateOne(
      { _id: id },
      { $set: updateData }
    );
    return { _id: id, ...updateData };
  },

  async deleteLeave(id) {
    const db = await connectToMongo();
    await db.collection('leaves').deleteOne({ _id: id });
    return { success: true };
  }
};

module.exports = { database, connectToMongo };
