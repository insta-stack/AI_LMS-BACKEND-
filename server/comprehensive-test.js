const { supabase } = require('./database');

async function comprehensiveTest() {
  console.log('=== COMPREHENSIVE DATABASE TEST ===');
  console.log('Environment:', {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    keyPrefix: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 20) + '...'
  });
  
  const tables = ['admin', 'teacher', 'student', 'staff'];
  
  for (const table of tables) {
    console.log(`\n=== TESTING ${table.toUpperCase()} TABLE ===`);
    
    try {
      // Method 1: Basic select all
      console.log('1. Basic select all:');
      const { data: allData, error: allError, count } = await supabase
        .from(table)
        .select('*', { count: 'exact' });
      
      if (allError) {
        console.log('   ❌ Error:', allError.message);
        console.log('   ❌ Code:', allError.code);
        console.log('   ❌ Details:', allError.details);
      } else {
        console.log(`   ✅ Success: ${count || allData?.length || 0} records`);
        if (allData && allData.length > 0) {
          console.log('   ✅ Sample record:', allData[0]);
          console.log('   ✅ All columns:', Object.keys(allData[0]));
        }
      }
      
      // Method 2: Select specific columns
      console.log('2. Select specific columns (_id, email, password):');
      const { data: specificData, error: specificError } = await supabase
        .from(table)
        .select('_id, email, password');
      
      if (specificError) {
        console.log('   ❌ Error:', specificError.message);
      } else {
        console.log(`   ✅ Success: ${specificData?.length || 0} records`);
        if (specificData && specificData.length > 0) {
          specificData.forEach((record, index) => {
            console.log(`   Record ${index + 1}:`, {
              _id: record._id,
              email: record.email,
              password: record.password,
              passwordType: typeof record.password
            });
          });
        }
      }
      
      // Method 3: Try with different filters
      console.log('3. Testing with email filter:');
      const { data: filterData, error: filterError } = await supabase
        .from(table)
        .select('*')
        .not('email', 'is', null);
      
      if (filterError) {
        console.log('   ❌ Filter error:', filterError.message);
      } else {
        console.log(`   ✅ Filter success: ${filterData?.length || 0} records`);
      }
      
      // Method 4: Try to insert test data
      console.log('4. Testing insert capability:');
      const testData = {
        email: `test-${Date.now()}@example.com`,
        password: 123456
      };
      
      const { data: insertData, error: insertError } = await supabase
        .from(table)
        .insert([testData])
        .select();
      
      if (insertError) {
        console.log('   ❌ Insert error:', insertError.message);
        console.log('   ❌ Insert code:', insertError.code);
        
        if (insertError.code === '23505') {
          console.log('   ⚠️  Unique constraint - data might exist');
        } else if (insertError.message.includes('RLS') || insertError.message.includes('policy')) {
          console.log('   ⚠️  RLS policy blocking insert');
        }
      } else {
        console.log('   ✅ Insert successful:', insertData);
        
        // Clean up test data
        await supabase.from(table).delete().eq('email', testData.email);
        console.log('   ✅ Test data cleaned up');
      }
      
    } catch (err) {
      console.log(`   ❌ Exception testing ${table}:`, err.message);
    }
  }
  
  console.log('\n=== TESTING SPECIFIC USER ===');
  
  // Test for the specific user you mentioned
  try {
    const { data: userData, error: userError } = await supabase
      .from('student')
      .select('*')
      .eq('email', 'alan12@gmail.com');
    
    if (userError) {
      console.log('❌ User lookup error:', userError.message);
    } else {
      console.log(`✅ User lookup: ${userData?.length || 0} records found`);
      if (userData && userData.length > 0) {
        console.log('✅ User data:', userData[0]);
      }
    }
  } catch (err) {
    console.log('❌ User lookup exception:', err.message);
  }
  
  console.log('\n=== TEST COMPLETE ===');
  
  if (process.argv.includes('--add-test-user')) {
    console.log('\n=== ADDING TEST USER ===');
    try {
      const { data, error } = await supabase
        .from('student')
        .insert([{
          email: 'alan12@gmail.com',
          password: 12345678
        }])
        .select();
      
      if (error) {
        console.log('❌ Failed to add test user:', error.message);
      } else {
        console.log('✅ Test user added:', data);
      }
    } catch (err) {
      console.log('❌ Exception adding test user:', err.message);
    }
  }
}

if (require.main === module) {
  comprehensiveTest().catch(console.error);
}

module.exports = { comprehensiveTest };