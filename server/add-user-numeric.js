const { supabase } = require('./database');

async function addUserWithNumericPassword() {
  console.log('=== ADDING USER WITH NUMERIC PASSWORD ===');
  
  try {
    // Try to add a user with numeric password
    const userData = {
      email: 'alan12@gmail.com',
      password: 12345678  // Numeric password instead of string
    };
    
    console.log('Attempting to insert user with numeric password...');
    
    const { data, error } = await supabase
      .from('student')
      .insert([userData])
      .select();
    
    if (error) {
      console.log('❌ Insert failed:', error.message);
      console.log('   Error code:', error.code);
      
      if (error.code === '23505') {
        console.log('   User already exists, trying to update...');
        
        const { data: updateData, error: updateError } = await supabase
          .from('student')
          .update({ password: 12345678 })
          .eq('email', 'alan12@gmail.com')
          .select();
        
        if (updateError) {
          console.log('❌ Update failed:', updateError.message);
        } else {
          console.log('✅ User updated successfully:', updateData);
        }
      }
    } else {
      console.log('✅ User inserted successfully:', data);
    }
    
    // Test the login with numeric password
    console.log('\nTesting login with numeric password...');
    
    const { data: loginData, error: loginError } = await supabase
      .from('student')
      .select('*')
      .eq('email', 'alan12@gmail.com')
      .eq('password', 12345678);
    
    if (loginError) {
      console.log('❌ Login test failed:', loginError.message);
    } else {
      console.log('✅ Login test result:', loginData?.length || 0, 'records found');
      if (loginData && loginData.length > 0) {
        console.log('✅ User found:', {
          email: loginData[0].email,
          password: loginData[0].password,
          passwordType: typeof loginData[0].password
        });
      }
    }
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
  
  console.log('\n=== NUMERIC PASSWORD TEST COMPLETE ===');
}

if (require.main === module) {
  addUserWithNumericPassword().catch(console.error);
}

module.exports = { addUserWithNumericPassword };