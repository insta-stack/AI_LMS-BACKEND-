const { supabase } = require('./database');

async function checkColumns() {
  console.log('=== CHECKING TABLE COLUMNS ===');
  
  const tables = ['admin', 'teacher', 'student', 'staff'];
  
  for (const table of tables) {
    console.log(`\n${table.toUpperCase()} TABLE:`);
    
    try {
      // Try to insert a minimal record to see what columns are required/available
      const testData = {
        email: `test-${Date.now()}@example.com`,
        password: 'test123'
      };
      
      const { data, error } = await supabase
        .from(table)
        .insert([testData])
        .select();
      
      if (error) {
        console.log(`   Insert error: ${error.message}`);
        console.log(`   Error code: ${error.code}`);
        
        // Parse the error to understand the schema
        if (error.message.includes('column') && error.message.includes('does not exist')) {
          console.log('   ❌ Column mismatch - table schema is different than expected');
        } else if (error.message.includes('null value')) {
          console.log('   ⚠️  Required columns are missing from insert');
        }
      } else {
        console.log('   ✅ Insert successful');
        console.log('   Available columns:', Object.keys(data[0]));
        
        // Clean up test record
        await supabase.from(table).delete().eq('email', testData.email);
        console.log('   ✅ Test record cleaned up');
      }
      
      // Try a different approach - select with minimal columns
      const { data: selectData, error: selectError } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (selectError) {
        console.log(`   Select error: ${selectError.message}`);
      } else {
        if (selectData && selectData.length > 0) {
          console.log('   ✅ Table has data with columns:', Object.keys(selectData[0]));
        } else {
          console.log('   ⚠️  Table exists but is empty');
          
          // Try to get column info by attempting to select common columns
          const commonColumns = ['_id', 'id', 'email', 'password', 'full_name', 'created_at'];
          
          for (const col of commonColumns) {
            try {
              const { error: colError } = await supabase
                .from(table)
                .select(col)
                .limit(1);
              
              if (!colError) {
                console.log(`   ✅ Column exists: ${col}`);
              }
            } catch (err) {
              // Column doesn't exist
            }
          }
        }
      }
      
    } catch (err) {
      console.log(`   Exception: ${err.message}`);
    }
  }
  
  console.log('\n=== COLUMN CHECK COMPLETE ===');
}

if (require.main === module) {
  checkColumns().catch(console.error);
}

module.exports = { checkColumns };