const { supabase } = require('./database');
require('dotenv').config();

async function debugConnection() {
  console.log('=== DATABASE CONNECTION DEBUG ===');
  
  // Check environment variables
  console.log('1. Environment Variables:');
  console.log('   SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'NOT SET');
  console.log('   SUPABASE_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET' : 'NOT SET');
  console.log('   URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('   KEY (first 20 chars):', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 20) + '...');
  
  console.log('\n2. Testing basic connection...');
  
  try {
    // Test basic connection with a simple query
    const { data, error } = await supabase
      .from('student')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.log('❌ Connection error:', error);
      console.log('   Error code:', error.code);
      console.log('   Error message:', error.message);
      console.log('   Error details:', error.details);
      console.log('   Error hint:', error.hint);
    } else {
      console.log('✅ Basic connection successful');
      console.log('   Count result:', data);
    }
  } catch (err) {
    console.log('❌ Connection exception:', err.message);
  }

  console.log('\n3. Testing each table individually...');
  
  const tables = ['admin', 'teacher', 'student', 'staff'];
  
  for (const table of tables) {
    console.log(`\n   Testing ${table} table:`);
    
    try {
      // Test with different query methods
      console.log(`     Method 1: Basic select...`);
      const { data: data1, error: error1 } = await supabase
        .from(table)
        .select('*');
      
      if (error1) {
        console.log(`     ❌ Error:`, error1.message);
        console.log(`     ❌ Code:`, error1.code);
        console.log(`     ❌ Details:`, error1.details);
      } else {
        console.log(`     ✅ Success: ${data1?.length || 0} records`);
        if (data1 && data1.length > 0) {
          console.log(`     ✅ Sample record:`, {
            id: data1[0].id,
            email: data1[0].email,
            created_at: data1[0].created_at
          });
        }
      }

      console.log(`     Method 2: Count query...`);
      const { count, error: error2 } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error2) {
        console.log(`     ❌ Count error:`, error2.message);
      } else {
        console.log(`     ✅ Count: ${count}`);
      }

      console.log(`     Method 3: Limit 1 query...`);
      const { data: data3, error: error3 } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (error3) {
        console.log(`     ❌ Limit error:`, error3.message);
      } else {
        console.log(`     ✅ Limit result: ${data3?.length || 0} records`);
      }

    } catch (err) {
      console.log(`     ❌ Exception for ${table}:`, err.message);
    }
  }

  console.log('\n4. Testing specific user lookup...');
  
  try {
    const { data, error } = await supabase
      .from('student')
      .select('*')
      .eq('email', 'alan12@gmail.com');
    
    if (error) {
      console.log('❌ User lookup error:', error.message);
    } else {
      console.log('✅ User lookup result:', data?.length || 0, 'records');
      if (data && data.length > 0) {
        console.log('✅ Found user:', {
          id: data[0].id,
          email: data[0].email,
          full_name: data[0].full_name
        });
      }
    }
  } catch (err) {
    console.log('❌ User lookup exception:', err.message);
  }

  console.log('\n5. Testing RLS (Row Level Security)...');
  
  try {
    // Check if RLS is causing issues
    const { data, error } = await supabase
      .rpc('get_table_info', { table_name: 'student' })
      .single();
    
    if (error) {
      console.log('⚠️  RLS check failed (this is normal):', error.message);
    } else {
      console.log('✅ RLS info:', data);
    }
  } catch (err) {
    console.log('⚠️  RLS check exception (this is normal):', err.message);
  }

  console.log('\n=== DEBUG COMPLETE ===');
}

// Run the debug
if (require.main === module) {
  debugConnection().catch(console.error);
}

module.exports = { debugConnection };