const express = require('express');
const { supabase } = require('../database');
const router = express.Router();

// POST /api/auth/signup - User registration
router.post('/signup', async (req, res) => {
  try {
    const { email, password, userData } = req.body;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData
      }
    });

    if (error) throw error;

    res.status(201).json({
      message: 'User created successfully',
      user: data.user
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/auth/login - Role-based login
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    
    console.log('=== LOGIN ATTEMPT ===');
    console.log('Email:', email);
    console.log('Role:', role);
    console.log('Password length:', password ? password.length : 'undefined');
    
    if (!email || !password || !role) {
      console.log('Missing required fields');
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }
    
    if (!['admin', 'teacher', 'student', 'staff'].includes(role)) {
      console.log('Invalid role:', role);
      return res.status(400).json({ error: 'Valid role is required' });
    }

    console.log(`Checking ${role} table for user with email: ${email}`);

    // First, check if user exists with this email
    const { data: userCheck, error: userError } = await supabase
      .from(role)
      .select('*')
      .eq('email', email);

    console.log('User lookup result:', { 
      found: userCheck ? userCheck.length : 0, 
      error: userError?.message || 'none' 
    });

    if (userError) {
      console.log('Database error:', userError);
      return res.status(500).json({ error: 'Database error: ' + userError.message });
    }

    if (!userCheck || userCheck.length === 0) {
      console.log('No user found with email:', email);
      return res.status(401).json({ error: 'Invalid credentials - user not found' });
    }

    const user = userCheck[0];
    console.log('Found user:', { 
      _id: user._id, 
      email: user.email, 
      storedPasswordLength: user.password ? String(user.password).length : 'undefined' 
    });

    // Check password - handle both string and numeric passwords
    const storedPassword = user.password;
    const providedPassword = password;
    
    // Convert both to strings for comparison since DB stores as int8
    const storedPasswordStr = String(storedPassword);
    const providedPasswordStr = String(providedPassword);
    
    console.log('Password comparison:');
    console.log('  Stored password (raw):', storedPassword, typeof storedPassword);
    console.log('  Stored password (string):', storedPasswordStr);
    console.log('  Provided password (raw):', providedPassword, typeof providedPassword);
    console.log('  Provided password (string):', providedPasswordStr);
    
    if (storedPasswordStr !== providedPasswordStr) {
      console.log('Password mismatch');
      return res.status(401).json({ error: 'Invalid credentials - password mismatch' });
    }

    console.log('Login successful for:', email);

    // Return user data with role
    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        full_name: user.full_name,
        role: role,
        ...(role === 'teacher' && { subject: user.subject }),
        ...(role === 'student' && { class: user.class }),
        ...(role === 'staff' && { department: user.department })
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// POST /api/auth/logout - User logout
router.post('/logout', async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) throw error;

    res.json({ message: 'Logout successful' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/auth/user - Get current user
router.get('/user', async (req, res) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({ user });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// GET /api/auth/test-db - Test database connection and check for specific user
router.get('/test-db', async (req, res) => {
  try {
    const { email, role } = req.query;
    
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role parameters are required' });
    }

    console.log(`Testing database connection for ${email} in ${role} table`);

    const { data, error } = await supabase
      .from(role)
      .select('*')
      .eq('email', email);

    if (error) {
      console.log('Database error:', error);
      return res.status(500).json({ 
        error: 'Database error', 
        details: error.message,
        table: role 
      });
    }

    console.log('Database query result:', data);

    res.json({
      message: 'Database connection successful',
      table: role,
      email: email,
      found: data ? data.length : 0,
      users: data || []
    });
  } catch (error) {
    console.error('Test DB error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// GET /api/auth/test-all-students - Fetch all student data for testing
router.get('/test-all-students', async (req, res) => {
  try {
    console.log('Fetching all students from database...');

    const { data: students, error, count } = await supabase
      .from('student')
      .select('*', { count: 'exact' });

    if (error) {
      console.log('Database error:', error);
      return res.status(500).json({ 
        error: 'Database error', 
        details: error.message 
      });
    }

    console.log(`Found ${count || students.length} students`);

    // Log student data (without passwords in production)
    students.forEach((student, index) => {
      console.log(`Student ${index + 1}:`, {
        id: student.id,
        email: student.email,
        full_name: student.full_name,
        class: student.class,
        passwordLength: student.password ? student.password.length : 0
      });
    });

    res.json({
      message: 'Students fetched successfully',
      count: count || students.length,
      students: students.map(student => ({
        id: student.id,
        email: student.email,
        full_name: student.full_name,
        class: student.class,
        created_at: student.created_at,
        // Include password for testing (remove in production)
        password: student.password
      }))
    });
  } catch (error) {
    console.error('Test all students error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// GET /api/auth/test-tables - Test all role tables
router.get('/test-tables', async (req, res) => {
  try {
    console.log('Testing all role tables...');
    
    const tables = ['admin', 'teacher', 'student', 'staff'];
    const results = {};

    for (const table of tables) {
      try {
        const { data, error, count } = await supabase
          .from(table)
          .select('*', { count: 'exact' });
        
        if (error) {
          results[table] = { 
            status: 'error', 
            error: error.message,
            count: 0 
          };
        } else {
          results[table] = { 
            status: 'success', 
            count: count || data.length,
            sample: data.length > 0 ? {
              id: data[0].id,
              email: data[0].email,
              full_name: data[0].full_name
            } : null
          };
        }
      } catch (err) {
        results[table] = { 
          status: 'error', 
          error: err.message,
          count: 0 
        };
      }
    }

    console.log('Table test results:', results);

    res.json({
      message: 'Table test completed',
      results
    });
  } catch (error) {
    console.error('Test tables error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// This file is deprecated - using PostgreSQL auth in server/index.js instead
// // This file is deprecated - using PostgreSQL auth in server/index.js instead
// module.exports = router;