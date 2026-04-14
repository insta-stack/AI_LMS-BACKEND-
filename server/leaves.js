const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

// Import the MongoDB database connection
const sql = require('../../db.js');

// Helper function to get user info from appropriate collection
async function getUserInfo(userId) {
  const collections = ['admin', 'teacher', 'student', 'staff'];
  
  for (const collection of collections) {
    try {
      const user = await sql.findOne(collection, { _id: userId });
      if (user) {
        return {
          name: user.name,
          email: user.email,
          role: user.role || collection,
          subject: user.subject,
          department: user.department,
          class: user.class
        };
      }
    } catch (error) {
      console.log(`User not found in ${collection} collection`);
    }
  }
  
  return {
    name: 'Unknown User',
    email: 'unknown@email.com',
    role: 'unknown'
  };
}

// GET /api/leaves - Get all leaves (admin view)
router.get('/', async (req, res) => {
  try {
    console.log('=== FETCHING ALL LEAVES ===');

    // Get all leaves from MongoDB
    const leaves = await sql.find('leaves', {}, { 
      sort: { created_at: -1 } 
    });

    console.log(`✅ Found ${leaves.length} leaves in database`);

    // Enhance leaves with user information
    const enhancedLeaves = await Promise.all(
      leaves.map(async (leave) => {
        const userInfo = await getUserInfo(leave.user_id);
        return {
          ...leave,
          user: userInfo
        };
      })
    );

    return res.status(200).json(enhancedLeaves);

  } catch (error) {
    console.error('❌ Error fetching leaves:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch leaves: ${error.message}`
    });
  }
});

// GET /api/leaves/user/:userId - Get leaves for a specific user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`=== FETCHING LEAVES FOR USER ${userId} ===`);

    // Convert userId to appropriate type (string or ObjectId)
    let query = { user_id: userId };
    
    // Try with ObjectId if it's a valid ObjectId format
    if (ObjectId.isValid(userId)) {
      query = { 
        $or: [
          { user_id: userId },
          { user_id: new ObjectId(userId) }
        ]
      };
    }

    const leaves = await sql.find('leaves', query, { 
      sort: { created_at: -1 } 
    });

    console.log(`✅ Found ${leaves.length} leaves for user ${userId}`);

    // Enhance leaves with user information
    const enhancedLeaves = await Promise.all(
      leaves.map(async (leave) => {
        const userInfo = await getUserInfo(leave.user_id);
        return {
          ...leave,
          user: userInfo
        };
      })
    );

    return res.status(200).json(enhancedLeaves);

  } catch (error) {
    console.error('❌ Error fetching user leaves:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch user leaves: ${error.message}`
    });
  }
});

// POST /api/leaves - Create a new leave request
router.post('/', async (req, res) => {
  try {
    console.log('=== CREATING NEW LEAVE REQUEST ===');
    console.log('Request body:', req.body);

    const { user_id, leave_date, reason, leave_type = 'sick' } = req.body;

    // Validation
    if (!user_id || !leave_date || !reason) {
      return res.status(400).json({
        success: false,
        error: 'user_id, leave_date, and reason are required'
      });
    }

    // Validate leave_type
    const validLeaveTypes = ['sick', 'personal', 'emergency', 'vacation'];
    if (!validLeaveTypes.includes(leave_type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid leave_type. Must be one of: sick, personal, emergency, vacation'
      });
    }

    // Check if user already has a leave request for this date
    let existingQuery = { user_id: user_id, leave_date: leave_date };
    
    // Try with ObjectId if it's a valid ObjectId format
    if (ObjectId.isValid(user_id)) {
      existingQuery = { 
        $or: [
          { user_id: user_id, leave_date: leave_date },
          { user_id: new ObjectId(user_id), leave_date: leave_date }
        ]
      };
    }

    const existingLeave = await sql.findOne('leaves', existingQuery);
    
    if (existingLeave) {
      return res.status(409).json({
        success: false,
        error: 'Leave request already exists for this date'
      });
    }

    // Create new leave request
    const leaveData = {
      user_id: user_id,
      leave_date: leave_date,
      reason: reason.trim(),
      leave_type: leave_type,
      status: 'pending',
      admin_notes: null,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await sql.insertOne('leaves', leaveData);
    
    // Get the inserted document
    const insertedLeave = await sql.findOne('leaves', { _id: result.insertedId });

    console.log('✅ Leave request created successfully:', insertedLeave);

    return res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully',
      data: insertedLeave
    });

  } catch (error) {
    console.error('❌ Error creating leave request:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to create leave request: ${error.message}`
    });
  }
});

// PATCH /api/leaves/:id - Update leave status (admin only)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;

    console.log(`=== UPDATING LEAVE ${id} ===`);
    console.log('Update data:', { status, admin_notes });

    // Validation
    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'status is required'
      });
    }

    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: pending, approved, rejected'
      });
    }

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    // Check if leave exists
    const existingLeave = await sql.findOne('leaves', query);
    if (!existingLeave) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found'
      });
    }

    // Update leave
    const updateData = {
      $set: {
        status: status,
        updated_at: new Date()
      }
    };

    if (admin_notes) {
      updateData.$set.admin_notes = admin_notes;
    }

    const result = await sql.updateOne('leaves', query, updateData);

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found'
      });
    }

    // Get updated document
    const updatedLeave = await sql.findOne('leaves', query);

    console.log('✅ Leave status updated successfully:', updatedLeave);

    return res.status(200).json({
      success: true,
      message: `Leave request ${status} successfully`,
      data: updatedLeave
    });

  } catch (error) {
    console.error('❌ Error updating leave status:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to update leave status: ${error.message}`
    });
  }
});

// PUT /api/leaves/:id - Update leave request (for teachers to edit their own requests)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, leave_type } = req.body;

    console.log(`=== UPDATING LEAVE REQUEST ${id} ===`);
    console.log('Update data:', { reason, leave_type });

    // Validation
    if (!reason || !leave_type) {
      return res.status(400).json({
        success: false,
        error: 'reason and leave_type are required'
      });
    }

    const validLeaveTypes = ['sick', 'personal', 'emergency', 'vacation'];
    if (!validLeaveTypes.includes(leave_type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid leave_type. Must be one of: sick, personal, emergency, vacation'
      });
    }

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    // Check if leave exists and is still pending
    const existingLeave = await sql.findOne('leaves', query);
    if (!existingLeave) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found'
      });
    }

    if (existingLeave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Only pending leave requests can be edited'
      });
    }

    // Update leave
    const updateData = {
      $set: {
        reason: reason.trim(),
        leave_type: leave_type,
        updated_at: new Date()
      }
    };

    const result = await sql.updateOne('leaves', query, updateData);

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found'
      });
    }

    // Get updated document
    const updatedLeave = await sql.findOne('leaves', query);

    console.log('✅ Leave request updated successfully:', updatedLeave);

    return res.status(200).json({
      success: true,
      message: 'Leave request updated successfully',
      data: updatedLeave
    });

  } catch (error) {
    console.error('❌ Error updating leave request:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to update leave request: ${error.message}`
    });
  }
});

// DELETE /api/leaves/:id - Delete a leave request
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`=== DELETING LEAVE ${id} ===`);

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    // Check if leave exists and is still pending
    const existingLeave = await sql.findOne('leaves', query);
    if (!existingLeave) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found'
      });
    }

    if (existingLeave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Only pending leave requests can be deleted'
      });
    }

    const result = await sql.deleteOne('leaves', query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found'
      });
    }

    console.log('✅ Leave request deleted successfully');

    return res.status(200).json({
      success: true,
      message: 'Leave request deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting leave request:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to delete leave request: ${error.message}`
    });
  }
});

module.exports = router;
