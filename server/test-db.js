const { supabase } = require('./database');

async function testDatabase() {
  console.log('=== DATABASE TEST SCRIPT ===');
  console.log('Testing connection to Supabase...\n');

  try {
    // Test 1: Check all tables
    console.log('1. Testing table access...');
    const tables = ['admin', 'teacher', 'student', 'staff'];
    
    for (const table of tables) {
      try {
        const { data, error, count } = await supabase
          .from(table)
          .select('*', { count: 'exact' });
        
        if (error) {
          console.log(`❌ ${table} table error:`, error.message);
        } else {
          console.log(`✅ ${table} table: ${count || data.length} records found`);
        }
      } catch (err) {
        console.log(`❌ ${table} table access failed:`, err.message);
      }
    }

    console.log('\n2. Fetching ALL student data...');
    
    // Test 2: Get all students
    const { data: students, error: studentError } = await supabase
      .from('student')
      .select('*');

    if (studentError) {
      console.log('❌ Error fetching students:', studentError.message);
      return;
    }

    console.log(`✅ Found ${students.length} students in database:`);
    console.log('='.repeat(80));
    
    if (students.length === 0) {
      console.log('⚠️  No students found in database!');
      console.log('You need to add student records to your Supabase student table.');
    } else {
      students.forEach((student, index) => {
        console.log(`Student ${index + 1}:`);
        console.log(`  ID: ${student._id}`);
        console.log(`  Email: ${student.email}`);
        console.log(`  Password: ${student.password}`);
        console.log(`  Full Name: ${student.full_name || 'Not set'}`);
        console.log(`  Class: ${student.class || 'Not set'}`);
        console.log(`  Created: ${student.created_at || 'Not set'}`);
        console.log('-'.repeat(40));
      });
    }

    // Test 3: Check for specific user
    console.log('\n3. Testing specific user lookup...');
    const testEmail = 'alan12@gmail.com';
    
    const { data: specificUser, error: specificError } = await supabase
      .from('student')
      .select('*')
      .eq('email', testEmail);

    if (specificError) {
      console.log(`❌ Error looking up ${testEmail}:`, specificError.message);
    } else if (specificUser.length === 0) {
      console.log(`⚠️  User ${testEmail} not found in student table`);
    } else {
      console.log(`✅ Found user ${testEmail}:`);
      console.log('  Data:', specificUser[0]);
    }

    // Test 4: Database schema check
    console.log('\n4. Checking student table schema...');
    const { data: schemaData, error: schemaError } = await supabase
      .from('student')
      .select('*')
      .limit(1);

    if (!schemaError && schemaData.length > 0) {
      console.log('✅ Student table columns:');
      Object.keys(schemaData[0]).forEach(column => {
        console.log(`  - ${column}: ${typeof schemaData[0][column]}`);
      });
    }

  } catch (error) {
    console.log('❌ Database test failed:', error.message);
  }
}

// Test authentication function
async function testAuth(email, password, role) {
  console.log('\n=== AUTHENTICATION TEST ===');
  console.log(`Testing login for: ${email} (${role})`);
  
  try {
    const { data: userCheck, error: userError } = await supabase
      .from(role)
      .select('*')
      .eq('email', email);

    if (userError) {
      console.log('❌ Database error:', userError.message);
      return false;
    }

    if (!userCheck || userCheck.length === 0) {
      console.log('❌ User not found');
      return false;
    }

    const user = userCheck[0];
    console.log('✅ User found:', {
      _id: user._id,
      email: user.email,
      password: user.password,
      passwordType: typeof user.password
    });

    // Handle both string and numeric password comparison
    const storedPassword = String(user.password);
    const providedPassword = String(password);
    
    console.log('Password comparison:');
    console.log(`  Stored (raw): ${user.password} (${typeof user.password})`);
    console.log(`  Stored (string): "${storedPassword}"`);
    console.log(`  Provided (string): "${providedPassword}"`);

    if (storedPassword === providedPassword) {
      console.log('✅ Password matches!');
      return true;
    } else {
      console.log('❌ Password mismatch');
      return false;
    }
  } catch (error) {
    console.log('❌ Auth test error:', error.message);
    return false;
  }
}

// Run tests
async function runAllTests() {
  await testDatabase();
  
  // Test specific login
  console.log('\n' + '='.repeat(80));
  await testAuth('alan12@gmail.com', '12345678', 'student');
  
  console.log('\n=== TEST COMPLETE ===');
}

// Run if called directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { testDatabase, testAuth, runAllTests };