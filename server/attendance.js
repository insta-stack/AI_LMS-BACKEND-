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

// Helper function to get current date in YYYY-MM-DD format
function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

// Helper function to get current time in HH:MM:SS format
function getCurrentTime() {
  return new Date().toLocaleTimeString('en-US', { 
    hour12: false, 
    timeZone: 'UTC' 
  });
}

// GET /api/attendance - Get all attendance records (admin view)
router.get('/', async (req, res) => {
  try {
    console.log('=== FETCHING ALL ATTENDANCE RECORDS ===');

    const { date, user_id, month, year } = req.query;
    let query = {};

    // Filter by specific date
    if (date) {
      query.date = date;
    }

    // Filter by user
    if (user_id) {
      query.user_id = user_id;
    }

    // Filter by month and year
    if (month && year) {
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      const endDate = `${year}-${month.padStart(2, '0')}-31`;
      query.date = {
        $gte: startDate,
        $lte: endDate
      };
    }

    // Get attendance records from MongoDB
    const attendance = await sql.find('attendance', query, { 
      sort: { date: -1, punch_in_time: -1 } 
    });

    console.log(`✅ Found ${attendance.length} attendance records`);

    // Enhance attendance with user information
    const enhancedAttendance = await Promise.all(
      attendance.map(async (record) => {
        const userInfo = await getUserInfo(record.user_id);
        return {
          ...record,
          user: userInfo
        };
      })
    );

    return res.status(200).json(enhancedAttendance);

  } catch (error) {
    console.error('❌ Error fetching attendance:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch attendance: ${error.message}`
    });
  }
});

// GET /api/attendance/user/:userId - Get attendance for a specific user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { month, year, limit = 30 } = req.query;

    console.log(`=== FETCHING ATTENDANCE FOR USER ${userId} ===`);

    let query = { user_id: userId };

    // Filter by month and year if provided
    if (month && year) {
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      const endDate = `${year}-${month.padStart(2, '0')}-31`;
      query.date = {
        $gte: startDate,
        $lte: endDate
      };
    }

    const attendance = await sql.find('attendance', query, { 
      sort: { date: -1, punch_in_time: -1 },
      limit: parseInt(limit)
    });

    console.log(`✅ Found ${attendance.length} attendance records for user ${userId}`);

    // Enhance with user information
    const enhancedAttendance = await Promise.all(
      attendance.map(async (record) => {
        const userInfo = await getUserInfo(record.user_id);
        return {
          ...record,
          user: userInfo
        };
      })
    );

    return res.status(200).json(enhancedAttendance);

  } catch (error) {
    console.error('❌ Error fetching user attendance:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch user attendance: ${error.message}`
    });
  }
});

// GET /api/attendance/today/:userId - Get today's attendance for a user
router.get('/today/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const today = getCurrentDate();

    console.log(`=== FETCHING TODAY'S ATTENDANCE FOR USER ${userId} ===`);

    const todayAttendance = await sql.findOne('attendance', {
      user_id: userId,
      date: today
    });

    if (todayAttendance) {
      const userInfo = await getUserInfo(userId);
      return res.status(200).json({
        ...todayAttendance,
        user: userInfo
      });
    } else {
      return res.status(200).json(null);
    }

  } catch (error) {
    console.error('❌ Error fetching today\'s attendance:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch today's attendance: ${error.message}`
    });
  }
});

// POST /api/attendance/punch-in - Punch in
router.post('/punch-in', async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    const today = getCurrentDate();
    const currentTime = getCurrentTime();

    console.log(`=== PUNCH IN FOR USER ${user_id} ===`);

    // Check if user already punched in today
    const existingRecord = await sql.findOne('attendance', {
      user_id: user_id,
      date: today
    });

    if (existingRecord) {
      return res.status(409).json({
        success: false,
        error: 'Already punched in today'
      });
    }

    // Create new attendance record
    const attendanceData = {
      user_id: user_id,
      date: today,
      punch_in_time: currentTime,
      punch_out_time: null,
      total_hours: null,
      status: 'present',
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await sql.insertOne('attendance', attendanceData);
    const insertedRecord = await sql.findOne('attendance', { _id: result.insertedId });

    // Add user info
    const userInfo = await getUserInfo(user_id);

    console.log('✅ Punch in successful:', insertedRecord);

    return res.status(201).json({
      success: true,
      message: 'Punched in successfully',
      data: {
        ...insertedRecord,
        user: userInfo
      }
    });

  } catch (error) {
    console.error('❌ Error punching in:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to punch in: ${error.message}`
    });
  }
});

// POST /api/attendance/punch-out - Punch out
router.post('/punch-out', async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    const today = getCurrentDate();
    const currentTime = getCurrentTime();

    console.log(`=== PUNCH OUT FOR USER ${user_id} ===`);

    // Find today's attendance record
    const existingRecord = await sql.findOne('attendance', {
      user_id: user_id,
      date: today
    });

    if (!existingRecord) {
      return res.status(404).json({
        success: false,
        error: 'No punch-in record found for today'
      });
    }

    if (existingRecord.punch_out_time) {
      return res.status(409).json({
        success: false,
        error: 'Already punched out today'
      });
    }

    // Calculate total hours
    const punchInTime = new Date(`${today}T${existingRecord.punch_in_time}`);
    const punchOutTime = new Date(`${today}T${currentTime}`);
    const totalHours = ((punchOutTime - punchInTime) / (1000 * 60 * 60)).toFixed(2);

    // Update attendance record
    const updateData = {
      $set: {
        punch_out_time: currentTime,
        total_hours: parseFloat(totalHours),
        updated_at: new Date()
      }
    };

    await sql.updateOne('attendance', { _id: existingRecord._id }, updateData);

    // Get updated record
    const updatedRecord = await sql.findOne('attendance', { _id: existingRecord._id });
    const userInfo = await getUserInfo(user_id);

    console.log('✅ Punch out successful:', updatedRecord);

    return res.status(200).json({
      success: true,
      message: 'Punched out successfully',
      data: {
        ...updatedRecord,
        user: userInfo
      }
    });

  } catch (error) {
    console.error('❌ Error punching out:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to punch out: ${error.message}`
    });
  }
});

// GET /api/attendance/stats/:userId - Get attendance statistics for a user
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { month, year } = req.query;

    console.log(`=== FETCHING ATTENDANCE STATS FOR USER ${userId} ===`);

    // Default to current month/year if not provided
    const currentDate = new Date();
    const targetMonth = month || (currentDate.getMonth() + 1);
    const targetYear = year || currentDate.getFullYear();

    // Calculate date range for the month
    const startDate = `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`;
    const endDate = `${targetYear}-${targetMonth.toString().padStart(2, '0')}-31`;

    // Get attendance records for the month
    const monthlyAttendance = await sql.find('attendance', {
      user_id: userId,
      date: {
        $gte: startDate,
        $lte: endDate
      }
    });

    // Calculate statistics
    const totalDays = monthlyAttendance.length;
    const presentDays = monthlyAttendance.filter(record => record.status === 'present').length;
    const totalHours = monthlyAttendance.reduce((sum, record) => sum + (record.total_hours || 0), 0);
    const averageHours = totalDays > 0 ? (totalHours / totalDays).toFixed(2) : 0;

    // Calculate working days in month (excluding weekends)
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    let workingDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(targetYear, targetMonth - 1, day);
      const dayOfWeek = date.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
        workingDays++;
      }
    }

    const attendancePercentage = workingDays > 0 ? ((presentDays / workingDays) * 100).toFixed(2) : 0;

    const stats = {
      month: parseInt(targetMonth),
      year: parseInt(targetYear),
      totalDays,
      presentDays,
      workingDays,
      totalHours: parseFloat(totalHours.toFixed(2)),
      averageHours: parseFloat(averageHours),
      attendancePercentage: parseFloat(attendancePercentage)
    };

    console.log('✅ Attendance stats calculated:', stats);

    return res.status(200).json(stats);

  } catch (error) {
    console.error('❌ Error fetching attendance stats:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch attendance stats: ${error.message}`
    });
  }
});

// DELETE /api/attendance/:id - Delete attendance record (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`=== DELETING ATTENDANCE RECORD ${id} ===`);

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    const result = await sql.deleteOne('attendance', query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    console.log('✅ Attendance record deleted successfully');

    return res.status(200).json({
      success: true,
      message: 'Attendance record deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting attendance record:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to delete attendance record: ${error.message}`
    });
  }
});

module.exports = router;
