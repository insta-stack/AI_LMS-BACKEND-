const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');

// Load environment variables FIRST
dotenv.config();

// Import database after environment variables are loaded
const sql = require('./db.js');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(morgan('dev')); // Request logging
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// CORS configuration - allow specific origins
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'http://localhost:3002',
    'https://ailms.mytechexpress.in',
    'http://ailms.mytechexpress.in'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// Import and use announcement routes
const announcementRoutes = require('./server/announcements');
app.use('/api/announcements', announcementRoutes);

// Import Google Generative AI
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Token usage tracking
let sessionTokenUsage = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  requestCount: 0,
  startTime: new Date()
};

// Import and use leaves routes
try {
  const leavesRoutes = require('./server/leaves');
  app.use('/api/leaves', leavesRoutes);
  console.log('✅ Leaves routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading leaves routes:', error.message);
}

// Import and use attendance routes
try {
  const attendanceRoutes = require('./server/attendance');
  app.use('/api/attendance', attendanceRoutes);
  console.log('✅ Attendance routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading attendance routes:', error.message);
}

// Import and use subjects routes
try {
  const subjectsRoutes = require('./server/subjects');
  app.use('/api/subjects', subjectsRoutes);
  console.log('✅ Subjects routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading subjects routes:', error.message);
}

// Import and use timetable routes
try {
  const timetableRoutes = require('./server/timetable');
  app.use('/api/timetable', timetableRoutes);
  console.log('✅ Timetable routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading timetable routes:', error.message);
}

// Import and use store routes
try {
  const storeRoutes = require('./server/store');
  app.use('/api/store', storeRoutes);
  console.log('✅ Store routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading store routes:', error.message);
}

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Token usage statistics route
app.get('/api/token-usage', (req, res) => {
  const sessionDuration = (new Date() - sessionTokenUsage.startTime) / 1000 / 60; // minutes
  
  res.status(200).json({
    success: true,
    tokenUsage: {
      ...sessionTokenUsage,
      sessionDurationMinutes: parseFloat(sessionDuration.toFixed(1)),
      averageTokensPerRequest: sessionTokenUsage.requestCount > 0 
        ? Math.round(sessionTokenUsage.totalTokens / sessionTokenUsage.requestCount) 
        : 0,
      costPerRequest: sessionTokenUsage.requestCount > 0 
        ? parseFloat((sessionTokenUsage.totalCost / sessionTokenUsage.requestCount).toFixed(6))
        : 0
    },
    timestamp: new Date().toISOString()
  });
});

// Reset token usage statistics
app.post('/api/token-usage/reset', (req, res) => {
  const oldUsage = { ...sessionTokenUsage };
  
  sessionTokenUsage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    requestCount: 0,
    startTime: new Date()
  };
  
  console.log('🔄 Token usage statistics reset');
  
  res.status(200).json({
    success: true,
    message: 'Token usage statistics reset successfully',
    previousUsage: oldUsage,
    timestamp: new Date().toISOString()
  });
});

// Test database connection
app.get('/test-db', async (req, res) => {
  try {
    console.log('Testing database connection...');
    const result = await sql`SELECT NOW() as current_time, 'Database connected!' as message`;

    res.json({
      success: true,
      message: 'Database connection successful',
      data: result[0]
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// Auth routes - NEW POSTGRESQL VERSION
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('=== POSTGRESQL LOGIN REQUEST ===');
    console.log('Request body:', req.body);

    const { email, password, role } = req.body;

    // Basic validation
    if (!email || !password || !role) {
      console.log('Validation failed: Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Email, password, and role are required'
      });
    }

    // Validate role
    if (!['admin', 'teacher', 'student', 'staff'].includes(role)) {
      console.log('Invalid role:', role);
      return res.status(400).json({
        success: false,
        message: 'Valid role is required (admin, teacher, student, staff)'
      });
    }

    console.log(`Attempting PostgreSQL login for: ${email} as ${role}`);

    try {
      // Test database connection first
      console.log('Testing database connection...');
      await sql`SELECT 1 as connection_test`;
      console.log('✅ Database connection test passed');

      // Query the specific role collection using native MongoDB
      console.log(`Querying ${role} collection for email: ${email}`);

      const users = await sql.find(role, { email: email });

      console.log(`Found ${users.length} users with email ${email} in ${role} collection`);

      if (users.length === 0) {
        console.log('❌ No user found with this email in the specified role collection');
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      const user = users[0];
      console.log('✅ User found:', {
        _id: user._id,
        email: user.email,
        name: user.name,
        grade: user.grade,
        storedPassword: user.password,
        storedPasswordType: typeof user.password
      });

      // Check password - handle both string and numeric passwords
      const storedPassword = String(user.password);
      const providedPassword = String(password);

      console.log('Password comparison:');
      console.log('  Stored password:', storedPassword);
      console.log('  Provided password:', providedPassword);
      console.log('  Match:', storedPassword === providedPassword);

      if (storedPassword !== providedPassword) {
        console.log('❌ Password mismatch');
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      console.log('✅ Login successful!');

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          role: role,
          name: user.name
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );

      console.log('✅ JWT token generated successfully');

      // Prepare user data based on role
      const userData = {
        id: user._id,
        email: user.email,
        name: user.name,
        role: role
      };

      // Add role-specific fields
      if (role === 'student') {
        console.log('Adding student-specific fields:', {
          grade: user.grade,
          student_id: user.student_id,
          parent_email: user.parent_email,
          fee_status: user.fee_status
        });
        userData.grade = user.grade;
        userData.student_id = user.student_id;
        userData.parent_email = user.parent_email;
        userData.fee_status = user.fee_status;
      } else if (role === 'teacher') {
        userData.teacher_id = user.teacher_id;
        userData.subject = user.subject;
        userData.department = user.department;
      } else if (role === 'admin') {
        userData.admin_id = user.admin_id;
        userData.permissions = user.permissions;
      }

      console.log('Final user data being returned:', userData);

      return res.status(200).json({
        success: true,
        message: `Login successful - Welcome ${role}!`,
        token,
        user: userData
      });

    } catch (dbError) {
      console.error('❌ Database error details:', {
        message: dbError.message,
        code: dbError.code,
        detail: dbError.detail,
        hint: dbError.hint
      });

      return res.status(500).json({
        success: false,
        message: `Database error: ${dbError.message || 'Unknown database error'}`,
        error: dbError.code || 'UNKNOWN_DB_ERROR'
      });
    }
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({
      success: false,
      message: `Server error during login: ${error.message}`,
      error: error.toString()
    });
  }
});

// Logout route
app.post('/api/auth/logout', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

// Token verification route
app.get('/api/auth/verify', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key'
    );

    return res.status(200).json({
      success: true,
      user: decoded
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

// Parent Info API routes
// POST - create parent/guardian record
app.post('/api/parent-info', async (req, res) => {
  try {
    console.log('=== CREATING PARENT INFO ===');
    console.log('Request body:', req.body);

    // Validate required fields
    const { student_id, guardian_name, guardian_phone, relation_with_student } = req.body;
    if (!student_id || !guardian_name || !guardian_phone || !relation_with_student) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: student_id, guardian_name, guardian_phone, and relation_with_student are required'
      });
    }

    const parentData = {
      ...req.body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Insert parent info into the parent_info collection
    const result = await sql.insertOne('parent_info', parentData);

    console.log('✅ Parent info created successfully:', result);

    return res.status(201).json({
      success: true,
      message: 'Parent information saved successfully',
      data: { ...parentData, _id: result.insertedId }
    });

  } catch (error) {
    console.error('❌ Error creating parent info:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to save parent information: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// GET - fetch parent info by student ID
app.get('/api/parent-info/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    console.log(`=== FETCHING PARENT INFO FOR STUDENT: ${studentId} ===`);

    const parentInfo = await sql.findOne('parent_info', { student_id: studentId });

    if (!parentInfo) {
      return res.status(404).json({
        success: false,
        message: 'Parent information not found for this student'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Parent information retrieved successfully',
      data: parentInfo
    });

  } catch (error) {
    console.error('❌ Error fetching parent info:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch parent information: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// Fee Info API routes
// POST - create fee record
app.post('/api/fee-info', async (req, res) => {
  try {
    console.log('=== CREATING FEE INFO ===');
    console.log('Request body:', req.body);

    // Validate required fields
    const { student_id, total_fee, payment_plan } = req.body;
    if (!student_id || !total_fee || !payment_plan) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: student_id, total_fee, and payment_plan are required'
      });
    }

    const feeData = {
      ...req.body,
      total_fee: parseFloat(req.body.total_fee),
      amount_paid: parseFloat(req.body.amount_paid || 0),
      amount_due: parseFloat(req.body.amount_due || req.body.total_fee),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Insert fee info into the fee_info collection
    const result = await sql.insertOne('fee_info', feeData);

    console.log('✅ Fee info created successfully:', result);

    return res.status(201).json({
      success: true,
      message: 'Fee information saved successfully',
      data: { ...feeData, _id: result.insertedId }
    });

  } catch (error) {
    console.error('❌ Error creating fee info:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to save fee information: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// GET - fetch fee info by student ID
app.get('/api/fee-info/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    console.log(`=== FETCHING FEE INFO FOR STUDENT: ${studentId} ===`);

    // Try to find fee info with both string and ObjectId formats
    let feeInfo = await sql.findOne('fee_info', { student_id: studentId });
    
    // If not found and studentId looks like an ObjectId, try with ObjectId
    if (!feeInfo && studentId.match(/^[0-9a-fA-F]{24}$/)) {
      const { ObjectId } = require('mongodb');
      feeInfo = await sql.findOne('fee_info', { student_id: new ObjectId(studentId) });
    }
    
    // If still not found, try the reverse - if we have an ObjectId, try as string
    if (!feeInfo) {
      try {
        const { ObjectId } = require('mongodb');
        const objectId = new ObjectId(studentId);
        feeInfo = await sql.findOne('fee_info', { student_id: objectId.toString() });
      } catch (e) {
        // Not a valid ObjectId, continue with original logic
      }
    }

    if (!feeInfo) {
      return res.status(404).json({
        success: false,
        message: 'Fee information not found for this student'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Fee information retrieved successfully',
      data: feeInfo
    });

  } catch (error) {
    console.error('❌ Error fetching fee info:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch fee information: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// PUT - update fee payment
app.put('/api/fee-info/:studentId/payment', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { payment_amount, payment_date } = req.body;
    
    console.log(`=== UPDATING FEE PAYMENT FOR STUDENT: ${studentId} ===`);
    console.log('Payment details:', { payment_amount, payment_date });

    if (!payment_amount || payment_amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment amount is required'
      });
    }

    // Get current fee info - try both string and ObjectId formats
    let currentFeeInfo = await sql.findOne('fee_info', { student_id: studentId });
    
    // If not found and studentId looks like an ObjectId, try with ObjectId
    if (!currentFeeInfo && studentId.match(/^[0-9a-fA-F]{24}$/)) {
      const { ObjectId } = require('mongodb');
      currentFeeInfo = await sql.findOne('fee_info', { student_id: new ObjectId(studentId) });
    }
    
    if (!currentFeeInfo) {
      return res.status(404).json({
        success: false,
        message: 'Fee information not found for this student'
      });
    }

    const newAmountPaid = currentFeeInfo.amount_paid + parseFloat(payment_amount);
    const newAmountDue = currentFeeInfo.total_fee - newAmountPaid;
    
    let newFeeStatus = 'pending';
    if (newAmountDue <= 0) {
      newFeeStatus = 'paid';
    } else if (newAmountPaid > 0) {
      newFeeStatus = 'partially_paid';
    }

    // Calculate next due date based on payment plan
    let nextDueDate = new Date(payment_date || new Date());
    if (currentFeeInfo.payment_plan === 'half_yearly') {
      nextDueDate.setMonth(nextDueDate.getMonth() + 6);
    } else if (currentFeeInfo.payment_plan === 'quarterly') {
      nextDueDate.setMonth(nextDueDate.getMonth() + 3);
    } else if (currentFeeInfo.payment_plan === 'yearly') {
      nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
    }

    const updateData = {
      amount_paid: newAmountPaid,
      amount_due: Math.max(0, newAmountDue),
      fee_status: newFeeStatus,
      next_due_date: nextDueDate.toISOString(),
      last_payment_date: payment_date || new Date().toISOString(),
      last_payment_amount: parseFloat(payment_amount),
      updated_at: new Date().toISOString()
    };

    // Update fee info using the same student_id format that was found
    const updateQuery = { student_id: currentFeeInfo.student_id };
    const result = await sql.updateOne('fee_info', updateQuery, { $set: updateData });

    console.log('✅ Fee payment updated successfully');

    return res.status(200).json({
      success: true,
      message: 'Fee payment updated successfully',
      data: { ...currentFeeInfo, ...updateData }
    });

  } catch (error) {
    console.error('❌ Error updating fee payment:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to update fee payment: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// Students API routes
// GET - fetch all students
app.get('/api/students', async (req, res) => {
  try {
    console.log('=== FETCHING ALL STUDENTS ===');

    // Query all students from the student collection using native MongoDB
    const students = await sql.find('student', {}, { sort: { _id: 1 } });

    console.log(`✅ Found ${students.length} students in database`);

    return res.status(200).json({
      success: true,
      message: `Successfully fetched ${students.length} students`,
      data: students,
      count: students.length
    });

  } catch (error) {
    console.error('❌ Error fetching students:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch students: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// POST - create new student
app.post('/api/students', async (req, res) => {
  try {
    console.log('=== CREATING NEW STUDENT ===');
    console.log('Request body:', req.body);

    // Validate required fields
    const { student_id, email, password, name, grade } = req.body;
    if (!student_id || !email || !password || !name || !grade) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: student_id, email, password, name, and grade are required'
      });
    }

    // Check if student with same email already exists
    const existingStudent = await sql.findOne('student', { email: email });
    if (existingStudent) {
      return res.status(409).json({
        success: false,
        message: 'A student with this email already exists'
      });
    }

    const studentData = {
      ...req.body,
      role: 'student',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Insert student into the student collection
    const result = await sql.insertOne('student', studentData);

    console.log('✅ Student created successfully:', result);

    return res.status(201).json({
      success: true,
      message: 'Student created successfully',
      data: { ...studentData, _id: result.insertedId }
    });

  } catch (error) {
    console.error('❌ Error creating student:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to create student: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// Teachers API routes
// GET - fetch all teachers
app.get('/api/teachers', async (req, res) => {
  try {
    console.log('=== FETCHING ALL TEACHERS ===');

    // Query all teachers from the teacher collection using native MongoDB
    const teachers = await sql.find('teacher', {}, { sort: { _id: 1 } });

    console.log(`✅ Found ${teachers.length} teachers in database`);

    return res.status(200).json({
      success: true,
      message: `Successfully fetched ${teachers.length} teachers`,
      data: teachers,
      count: teachers.length
    });

  } catch (error) {
    console.error('❌ Error fetching teachers:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch teachers: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// POST - create new teacher
app.post('/api/teachers', async (req, res) => {
  try {
    console.log('=== CREATING NEW TEACHER ===');
    console.log('Request body:', req.body);

    // Validate required fields
    const { teacher_id, email, password, name, subject } = req.body;
    if (!teacher_id || !email || !password || !name || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: teacher_id, email, password, name, and subject are required'
      });
    }

    // Check if teacher with same email already exists
    const existingTeacher = await sql.findOne('teacher', { email: email });
    if (existingTeacher) {
      return res.status(409).json({
        success: false,
        message: 'A teacher with this email already exists'
      });
    }

    const teacherData = {
      ...req.body,
      role: 'teacher',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Convert salary to number if provided
    if (teacherData.salary) {
      teacherData.salary = parseFloat(teacherData.salary);
    }

    // Insert teacher into the teacher collection
    const result = await sql.insertOne('teacher', teacherData);

    console.log('✅ Teacher created successfully:', result);

    return res.status(201).json({
      success: true,
      message: 'Teacher created successfully',
      data: { ...teacherData, _id: result.insertedId }
    });

  } catch (error) {
    console.error('❌ Error creating teacher:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to create teacher: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// Grades API route - fetch all grades
app.get('/api/grades', async (req, res) => {
  try {
    console.log('=== FETCHING ALL GRADES ===');

    // Query all grades from the grade collection using native MongoDB
    const grades = await sql.find('grade', {}, { sort: { id: 1 } });

    console.log(`✅ Found ${grades.length} grades in database`);

    // Log the first record to see the actual column structure for debugging
    if (grades.length > 0) {
      console.log('Sample grade record columns:', Object.keys(grades[0]));
      console.log('Sample grade data:', grades[0]);
    }

    return res.status(200).json({
      success: true,
      message: `Successfully fetched ${grades.length} grades`,
      data: grades,
      count: grades.length
    });

  } catch (error) {
    console.error('❌ Error fetching grades:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch grades: ${error.message}`,
      error: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// Test all tables route
app.get('/api/test-tables', async (req, res) => {
  try {
    console.log('Testing all collections...');

    const collections = ['admin', 'teacher', 'student', 'staff'];
    const results = {};

    for (const collection of collections) {
      try {
        const result = await sql.count(collection);
        results[collection] = {
          status: 'success',
          count: result[0].count
        };
        console.log(`${collection} collection: ${result[0].count} records`);
      } catch (error) {
        results[collection] = {
          status: 'error',
          error: error.message
        };
        console.log(`${collection} collection error:`, error.message);
      }
    }

    res.json({
      success: true,
      message: 'Collection test completed',
      results
    });
  } catch (error) {
    console.error('Table test error:', error);
    res.status(500).json({
      success: false,
      message: 'Collection test failed',
      error: error.message
    });
  }
});

// Test specific user route
app.get('/api/test-user', async (req, res) => {
  try {
    const { email, role } = req.query;

    if (!email || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email and role parameters are required'
      });
    }

    console.log(`Testing user lookup: ${email} in ${role} collection`);

    const users = await sql.find(role, { email: email });

    res.json({
      success: true,
      message: `User lookup completed for ${email} in ${role} collection`,
      found: users.length,
      users: users
    });
  } catch (error) {
    console.error('User test error:', error);
    res.status(500).json({
      success: false,
      message: 'User test failed',
      error: error.message
    });
  }
});

// AI Chat endpoint
app.post('/api/ai-chat', async (req, res) => {
  try {
    console.log('=== AI CHAT REQUEST ===');
    const { message, conversationHistory } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || 'your-api-key');
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Analyze the user's question to determine what data to fetch
    const dataNeeded = await analyzeUserQuery(message);
    let systemData = {};

    // Fetch relevant data based on the query
    if (dataNeeded.includes('students')) {
      try {
        const students = await sql.find('student', {}); // Removed limit to get all students
        systemData.students = {
          count: students.length,
          data: students.slice(0, 5), // Limit data for AI context
          summary: `Total students: ${students.length}`
        };
      } catch (error) {
        console.error('Error fetching students:', error);
      }
    }

    if (dataNeeded.includes('teachers')) {
      try {
        const teachers = await sql.find('teacher', {}); // Removed limit to get all teachers
        systemData.teachers = {
          count: teachers.length,
          data: teachers.slice(0, 5),
          summary: `Total teachers: ${teachers.length}`
        };
      } catch (error) {
        console.error('Error fetching teachers:', error);
      }
    }

    if (dataNeeded.includes('grades')) {
      try {
        const grades = await sql.find('grade', {}); // Removed limit to get all grades
        systemData.grades = {
          count: grades.length,
          data: grades.slice(0, 10),
          summary: `Total grades/classes: ${grades.length}`
        };
      } catch (error) {
        console.error('Error fetching grades:', error);
      }
    }

    if (dataNeeded.includes('attendance')) {
      try {
        // Fetch recent attendance records
        const attendance = await sql.find('attendance', {}, {
          limit: 500, // Increased limit for better attendance statistics
          sort: { date: -1 } // Sort by date descending to get recent records
        });

        // Calculate attendance statistics
        const totalRecords = attendance.length;
        const presentCount = attendance.filter(record => record.status === 'present').length;
        const absentCount = attendance.filter(record => record.status === 'absent').length;
        const lateCount = attendance.filter(record => record.status === 'late').length;

        const attendanceRate = totalRecords > 0 ? ((presentCount + lateCount) / totalRecords * 100).toFixed(1) : 0;

        // Get today's date for today's attendance
        const today = new Date().toISOString().split('T')[0];
        const todayAttendance = attendance.filter(record =>
          record.date && record.date.toString().includes(today)
        );

        systemData.attendance = {
          totalRecords: totalRecords,
          presentCount: presentCount,
          absentCount: absentCount,
          lateCount: lateCount,
          attendanceRate: `${attendanceRate}%`,
          todayAttendance: todayAttendance.length,
          recentRecords: attendance.slice(0, 10), // Last 10 records for context
          summary: `Total attendance records: ${totalRecords}, Overall attendance rate: ${attendanceRate}%, Today's records: ${todayAttendance.length}`
        };
      } catch (error) {
        console.error('Error fetching attendance:', error);
        // Provide fallback data structure
        systemData.attendance = {
          totalRecords: 0,
          summary: 'Attendance data temporarily unavailable'
        };
      }
    }

    if (dataNeeded.includes('subjects')) {
      try {
        const subjects = await sql.find('subject', {}); // Removed limit to get all subjects
        systemData.subjects = {
          count: subjects.length,
          data: subjects.slice(0, 10),
          summary: `Total subjects: ${subjects.length}`
        };
      } catch (error) {
        console.error('Error fetching subjects:', error);
      }
    }

    if (dataNeeded.includes('announcements')) {
      try {
        const announcements = await sql.find('announcement', {}, {
          limit: 100, // Increased limit for better announcement coverage
          sort: { created_at: -1 }
        });
        systemData.announcements = {
          count: announcements.length,
          data: announcements.slice(0, 5),
          summary: `Total announcements: ${announcements.length}`
        };
      } catch (error) {
        console.error('Error fetching announcements:', error);
      }
    }

    if (dataNeeded.includes('leaves')) {
      try {
        const leaves = await sql.find('leave', {}, {
          limit: 200, // Increased limit for better leave statistics
          sort: { created_at: -1 }
        });
        const pendingLeaves = leaves.filter(leave => leave.status === 'pending').length;
        const approvedLeaves = leaves.filter(leave => leave.status === 'approved').length;
        const rejectedLeaves = leaves.filter(leave => leave.status === 'rejected').length;

        systemData.leaves = {
          total: leaves.length,
          pending: pendingLeaves,
          approved: approvedLeaves,
          rejected: rejectedLeaves,
          data: leaves.slice(0, 5),
          summary: `Total leave requests: ${leaves.length}, Pending: ${pendingLeaves}, Approved: ${approvedLeaves}, Rejected: ${rejectedLeaves}`
        };
      } catch (error) {
        console.error('Error fetching leaves:', error);
      }
    }

    if (dataNeeded.includes('timetable')) {
      try {
        const timetable = await sql.find('timetable', {}); // Removed limit to get all timetable entries
        systemData.timetable = {
          count: timetable.length,
          data: timetable.slice(0, 10),
          summary: `Total timetable entries: ${timetable.length}`
        };
      } catch (error) {
        console.error('Error fetching timetable:', error);
      }
    }

    // Create context for AI
    const systemContext = `
You are an AI assistant for AILMS (AI Learning Management System). You help administrators, teachers, and staff get information about the school infrastructure.

Available data:
${JSON.stringify(systemData, null, 2)}

Current user question: "${message}"

Please provide a helpful, accurate response based on the available data. If you don't have specific data, mention that you can help fetch it or direct them to the appropriate section.

Be conversational, helpful, and professional. Format numbers nicely and provide actionable insights when possible.
`;

    // Generate AI response
    const result = await model.generateContent(systemContext);
    const response = result.response;
    const aiResponse = response.text();

    // Log token usage information
    const usageMetadata = response.usageMetadata;
    if (usageMetadata) {
      const inputTokens = usageMetadata.promptTokenCount || 0;
      const outputTokens = usageMetadata.candidatesTokenCount || 0;
      const totalTokens = usageMetadata.totalTokenCount || 0;
      
      // Calculate approximate cost (Gemini Pro pricing)
      const inputCost = inputTokens * 0.00025 / 1000; // $0.00025 per 1K input tokens
      const outputCost = outputTokens * 0.0005 / 1000; // $0.0005 per 1K output tokens
      const requestCost = inputCost + outputCost;
      
      // Update session tracking
      sessionTokenUsage.totalInputTokens += inputTokens;
      sessionTokenUsage.totalOutputTokens += outputTokens;
      sessionTokenUsage.totalTokens += totalTokens;
      sessionTokenUsage.totalCost += requestCost;
      sessionTokenUsage.requestCount += 1;
      
      console.log('📊 GEMINI TOKEN USAGE (This Request):');
      console.log(`   Input Tokens: ${inputTokens.toLocaleString()}`);
      console.log(`   Output Tokens: ${outputTokens.toLocaleString()}`);
      console.log(`   Total Tokens: ${totalTokens.toLocaleString()}`);
      console.log(`   Request Cost: $${requestCost.toFixed(6)}`);
      
      console.log('📈 SESSION TOTALS:');
      console.log(`   Total Requests: ${sessionTokenUsage.requestCount}`);
      console.log(`   Total Input Tokens: ${sessionTokenUsage.totalInputTokens.toLocaleString()}`);
      console.log(`   Total Output Tokens: ${sessionTokenUsage.totalOutputTokens.toLocaleString()}`);
      console.log(`   Total Tokens: ${sessionTokenUsage.totalTokens.toLocaleString()}`);
      console.log(`   Total Cost: $${sessionTokenUsage.totalCost.toFixed(6)}`);
      
      const sessionDuration = (new Date() - sessionTokenUsage.startTime) / 1000 / 60; // minutes
      console.log(`   Session Duration: ${sessionDuration.toFixed(1)} minutes`);
      console.log(`   Avg Tokens/Request: ${Math.round(sessionTokenUsage.totalTokens / sessionTokenUsage.requestCount)}`);
      
    } else {
      console.log('⚠️  Token usage metadata not available');
      sessionTokenUsage.requestCount += 1;
    }

    console.log('✅ AI response generated successfully');

    return res.status(200).json({
      success: true,
      response: aiResponse,
      data: systemData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ AI Chat error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process AI chat request',
      error: error.message
    });
  }
});

// Helper function to analyze user query and determine what data to fetch
async function analyzeUserQuery(message) {
  const lowerMessage = message.toLowerCase();
  const dataNeeded = [];

  // Keywords mapping
  const keywords = {
    students: ['student', 'pupil', 'learner', 'enrolled', 'enrollment', 'class size'],
    teachers: ['teacher', 'instructor', 'faculty', 'staff', 'educator', 'professor'],
    grades: ['grade', 'class', 'level', 'year', 'standard'],
    subjects: ['subject', 'course', 'curriculum', 'syllabus'],
    timetable: ['timetable', 'schedule', 'timing', 'period'],
    fees: ['fee', 'payment', 'tuition', 'cost', 'finance'],
    announcements: ['announcement', 'notice', 'news', 'update'],
    leaves: ['leave', 'absence', 'holiday', 'vacation'],
    attendance: ['attendance', 'present', 'absent', 'punctuality', 'attendance rate', 'attendance record', 'check-in', 'check-out', 'daily attendance', 'monthly attendance']
  };

  // Check for keywords in the message
  for (const [category, words] of Object.entries(keywords)) {
    if (words.some(word => lowerMessage.includes(word))) {
      dataNeeded.push(category);
    }
  }

  // If no specific keywords found, include basic data
  if (dataNeeded.length === 0) {
    dataNeeded.push('students', 'teachers', 'grades');
  }

  return dataNeeded;
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  console.error(err.stack);

  const statusCode = err.status || err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Server Error',
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack
  });
});

// Function to get local IP address
function getLocalIP() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

// Start server - bind to all network interfaces (0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();

  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Access URLs:`);
  console.log(`   🏠 Localhost: http://localhost:${PORT}`);
  console.log(`   🌐 Network:   http://${localIP}:${PORT}`);
  console.log('');
  console.log(`🔗 API Endpoints:`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Health check: http://${localIP}:${PORT}/api/health`);
  console.log(`   Test database: http://localhost:${PORT}/test-db`);
  console.log(`   Test database: http://${localIP}:${PORT}/test-db`);
  console.log(`   Test tables: http://localhost:${PORT}/api/test-tables`);
  console.log(`   Test tables: http://${localIP}:${PORT}/api/test-tables`);
  console.log('');
  console.log(`📱 Admin Dashboard:`);
  console.log(`   Localhost: http://localhost:3000/dashboard/admin`);
  console.log(`   Network:   http://${localIP}:3000/dashboard/admin`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
});

module.exports = app;