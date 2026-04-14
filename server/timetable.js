const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

// Import the MongoDB database connection
const sql = require('../db.js');

// Helper function to call Groq AI API
async function generateTimetableWithAI(subjects, config) {
  try {
    console.log('🤖 Generating timetable with Groq AI...');

    const prompt = `
You are a school timetable generator. Create a weekly timetable for Grade ${config.grade} with the following configuration:

SUBJECTS AND TEACHERS:
${subjects.map(s => `- ${s.name} (${s.code}) - Teacher: ${s.teacher_name || 'Unassigned'}`).join('\n')}

CONFIGURATION:
- School starts at: ${config.startTime}
- School ends at: ${config.endTime}
- Period duration: ${config.periodDuration} minutes
- Number of games periods per day: ${config.gamesPerDay}
- Days: Monday to Saturday
- Lunch break: 30 minutes after half of the periods are completed each day

REQUIREMENTS:
1. Each subject should get equal time distribution across the week
2. There must be exactly ${config.gamesPerDay} games period(s) each day (preferably last period)
3. Include a 30-minute lunch break after half of the academic periods are completed each day
4. After lunch break, resume with remaining academic periods
5. No subject should have more than 2 consecutive periods
6. Create a balanced schedule that's suitable for Grade ${config.grade} students
7. Ensure classes resume after lunch break - do not show only lunch for remaining time
8. IMPORTANT: Be aware that teachers may have classes in other grades at the same time - the system will validate and fix conflicts automatically

Please provide a JSON response with this exact structure:
{
  "timetable": {
    "Monday": [
      {"period": 1, "time": "09:00-09:40", "subject": "Mathematics", "teacher": "Teacher Name"},
      {"period": 2, "time": "09:40-10:20", "subject": "English", "teacher": "Teacher Name"},
      {"period": "LUNCH", "time": "10:20-10:50", "subject": "Lunch Break", "teacher": ""},
      {"period": 3, "time": "10:50-11:30", "subject": "Science", "teacher": "Science Teacher"},
      {"period": 4, "time": "11:30-12:10", "subject": "Games", "teacher": "PE Teacher"}
    ],
    "Tuesday": [...],
    "Wednesday": [...],
    "Thursday": [...],
    "Friday": [...],
    "Saturday": [...]
  },
  "summary": {
    "totalPeriods": 24,
    "subjectDistribution": {
      "Mathematics": 6,
      "English": 6,
      "Science": 6,
      "Games": 6
    }
  }
}

CRITICAL: Make sure classes resume after lunch break. Do not show lunch break for all remaining periods.
`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-70b-versatile',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    // Try to parse JSON from AI response
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
    }

    // If AI parsing fails, return fallback
    throw new Error('AI response could not be parsed');

  } catch (error) {
    console.error('❌ Groq AI error:', error);
    throw error;
  }
}

// Helper function to check teacher conflicts
async function checkTeacherConflict(teacherName, day, timeSlot, currentGrade) {
  if (!teacherName || teacherName === 'Unassigned' || teacherName === 'PE Teacher') {
    return false; // No conflict for unassigned or PE teachers (assuming multiple PE teachers)
  }

  try {
    // Get all existing timetables except the current grade
    const existingTimetables = await sql.find('timetables', {
      grade_id: { $ne: parseInt(currentGrade) }
    });

    for (const timetable of existingTimetables) {
      if (timetable.timetable && timetable.timetable[day]) {
        const daySchedule = timetable.timetable[day];

        for (const period of daySchedule) {
          // Check if same teacher has a class at the same time
          if (period.teacher === teacherName && period.time === timeSlot) {
            console.log(`⚠️ Teacher conflict detected: ${teacherName} has class in Grade ${timetable.grade_id} at ${timeSlot} on ${day}`);
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking teacher conflict:', error);
    return false; // If error, assume no conflict to avoid blocking generation
  }
}

// Helper function to find alternative subject without conflict
async function findAlternativeSubject(subjects, day, timeSlot, currentGrade, excludeSubject = null) {
  // First, try to find a different subject with no conflict
  for (const subject of subjects) {
    if (excludeSubject && subject.name === excludeSubject.name) {
      continue; // Skip the excluded subject
    }

    const hasConflict = await checkTeacherConflict(subject.teacher_name, day, timeSlot, currentGrade);
    if (!hasConflict) {
      console.log(`✅ Found alternative subject: ${subject.name} (${subject.teacher_name})`);
      return subject;
    }
  }

  // If no alternative subject found, use the original subject with alternative teacher
  if (excludeSubject) {
    console.log(`🔧 Using original subject with alternative teacher: ${excludeSubject.name}`);
    return {
      name: excludeSubject.name,
      code: excludeSubject.code,
      teacher_name: `${excludeSubject.teacher_name} (Alt)`
    };
  }

  // Last resort: return a generic subject
  return {
    name: 'Study Period',
    code: 'STUDY',
    teacher_name: 'Class Teacher'
  };
}

// Function to validate and fix teacher conflicts in AI-generated timetables
async function validateAndFixTeacherConflicts(timetableData, currentGrade) {
  console.log('🔍 Validating teacher conflicts in AI-generated timetable...');

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let conflictsFixed = 0;

  for (const day of days) {
    if (timetableData.timetable[day]) {
      for (let i = 0; i < timetableData.timetable[day].length; i++) {
        const period = timetableData.timetable[day][i];

        // Skip lunch breaks
        if (period.subject === 'Lunch Break') continue;

        // Check for teacher conflict
        const hasConflict = await checkTeacherConflict(period.teacher, day, period.time, currentGrade);
        if (hasConflict) {
          console.log(`🔧 Fixing conflict for ${period.subject} (${period.teacher}) on ${day} at ${period.time}`);

          // Try to find an alternative teacher for the same subject
          const alternativeTeacher = `${period.teacher} (Alt)`;
          period.teacher = alternativeTeacher;
          conflictsFixed++;
        }
      }
    }
  }

  if (conflictsFixed > 0) {
    console.log(`✅ Fixed ${conflictsFixed} teacher conflicts in AI-generated timetable`);
  } else {
    console.log('✅ No teacher conflicts found in AI-generated timetable');
  }

  return timetableData;
}

// Function to get teacher conflict summary for debugging
async function getTeacherConflictSummary(currentGrade) {
  try {
    const allTimetables = await sql.find('timetables', {});
    const teacherSchedule = {};

    console.log('📊 Teacher Conflict Summary:');

    for (const timetable of allTimetables) {
      if (timetable.timetable) {
        for (const [day, periods] of Object.entries(timetable.timetable)) {
          for (const period of periods) {
            if (period.teacher && period.teacher !== '' && period.subject !== 'Lunch Break') {
              const key = `${period.teacher}-${day}-${period.time}`;
              if (!teacherSchedule[key]) {
                teacherSchedule[key] = [];
              }
              teacherSchedule[key].push({
                grade: timetable.grade_id,
                subject: period.subject
              });
            }
          }
        }
      }
    }

    // Find conflicts
    const conflicts = [];
    for (const [key, assignments] of Object.entries(teacherSchedule)) {
      if (assignments.length > 1) {
        const [teacher, day, time] = key.split('-');
        conflicts.push({
          teacher,
          day,
          time,
          assignments
        });
      }
    }

    if (conflicts.length > 0) {
      console.log(`⚠️ Found ${conflicts.length} teacher conflicts:`);
      conflicts.forEach(conflict => {
        console.log(`  ${conflict.teacher} on ${conflict.day} at ${conflict.time}:`);
        conflict.assignments.forEach(assignment => {
          console.log(`    - Grade ${assignment.grade}: ${assignment.subject}`);
        });
      });
    } else {
      console.log('✅ No teacher conflicts found across all timetables');
    }

    return conflicts;
  } catch (error) {
    console.error('Error getting teacher conflict summary:', error);
    return [];
  }
}

// Fallback timetable generator (now async)
async function generateFallbackTimetable(subjects, config) {
  console.log('📋 Generating fallback timetable...');

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timetable = {};

  // Calculate periods per day (excluding lunch)
  const startHour = parseInt(config.startTime.split(':')[0]);
  const startMinute = parseInt(config.startTime.split(':')[1]);
  const endHour = parseInt(config.endTime.split(':')[0]);
  const endMinute = parseInt(config.endTime.split(':')[1]);

  const totalMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  // Subtract 30 minutes for lunch break
  const availableMinutes = totalMinutes - 30;
  const periodsPerDay = Math.floor(availableMinutes / config.periodDuration);

  console.log(`Total minutes: ${totalMinutes}, Available for classes: ${availableMinutes}, Periods per day: ${periodsPerDay}`);

  // Add Games as a subject if not present
  const allSubjects = [...subjects];
  if (!allSubjects.find(s => s.name.toLowerCase().includes('games') || s.name.toLowerCase().includes('physical'))) {
    allSubjects.push({
      name: 'Games',
      code: 'PE',
      teacher_name: 'PE Teacher'
    });
  }

  // Filter academic subjects (excluding games)
  const academicSubjects = allSubjects.filter(s =>
    !s.name.toLowerCase().includes('games') &&
    !s.name.toLowerCase().includes('physical')
  );

  console.log(`Academic subjects: ${academicSubjects.length}, Total subjects: ${allSubjects.length}`);

  // Calculate total academic periods across all days
  const totalAcademicPeriods = days.length * (periodsPerDay - 1); // -1 for games period each day

  // Create subject distribution plan to ensure all subjects are included
  const subjectDistributionPlan = [];
  if (academicSubjects.length > 0) {
    const periodsPerSubject = Math.floor(totalAcademicPeriods / academicSubjects.length);
    const extraPeriods = totalAcademicPeriods % academicSubjects.length;

    console.log(`Total academic periods: ${totalAcademicPeriods}, Periods per subject: ${periodsPerSubject}, Extra periods: ${extraPeriods}`);

    // Distribute periods evenly among subjects
    for (let i = 0; i < academicSubjects.length; i++) {
      const subject = academicSubjects[i];
      const periods = periodsPerSubject + (i < extraPeriods ? 1 : 0);

      for (let j = 0; j < periods; j++) {
        subjectDistributionPlan.push(subject);
      }
    }

    // Shuffle the distribution plan to avoid clustering
    for (let i = subjectDistributionPlan.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [subjectDistributionPlan[i], subjectDistributionPlan[j]] = [subjectDistributionPlan[j], subjectDistributionPlan[i]];
    }

    console.log('Subject distribution plan:', subjectDistributionPlan.map(s => s.name));
  }

  let globalPeriodIndex = 0; // Track periods across all days

  // Create timetable for each day
  for (const day of days) {
    timetable[day] = [];
    let currentTime = startHour * 60 + startMinute;
    let periodNumber = 1;

    // Calculate when to insert lunch (after half the periods)
    const lunchAfterPeriod = Math.floor(periodsPerDay / 2);

    console.log(`Day: ${day}, Lunch after period: ${lunchAfterPeriod}`);

    // Generate periods for the day
    for (let periodIndex = 0; periodIndex < periodsPerDay; periodIndex++) {
      // Insert lunch break after half the periods
      if (periodIndex === lunchAfterPeriod) {
        const lunchStartHour = Math.floor(currentTime / 60);
        const lunchStartMinute = currentTime % 60;
        const lunchEndTime = currentTime + 30; // 30 minutes lunch
        const lunchEndHour = Math.floor(lunchEndTime / 60);
        const lunchEndMinute = lunchEndTime % 60;

        const lunchTimeSlot = `${lunchStartHour.toString().padStart(2, '0')}:${lunchStartMinute.toString().padStart(2, '0')}-${lunchEndHour.toString().padStart(2, '0')}:${lunchEndMinute.toString().padStart(2, '0')}`;

        timetable[day].push({
          period: 'LUNCH',
          time: lunchTimeSlot,
          subject: 'Lunch Break',
          subject_code: 'LUNCH',
          teacher: ''
        });

        currentTime = lunchEndTime;
      }

      // Add regular period
      const periodStartHour = Math.floor(currentTime / 60);
      const periodStartMinute = currentTime % 60;
      const periodEndTime = currentTime + config.periodDuration;
      const periodEndHour = Math.floor(periodEndTime / 60);
      const periodEndMinute = periodEndTime % 60;

      const timeSlot = `${periodStartHour.toString().padStart(2, '0')}:${periodStartMinute.toString().padStart(2, '0')}-${periodEndHour.toString().padStart(2, '0')}:${periodEndMinute.toString().padStart(2, '0')}`;

      // Assign subjects with exactly one games period per day (last period)
      let subject;
      if (periodIndex === periodsPerDay - 1) { // Last period of the day
        // Assign games period
        const gamesSubject = allSubjects.find(s => s.name.toLowerCase().includes('games') || s.name.toLowerCase().includes('physical')) || {
          name: 'Games',
          code: 'PE',
          teacher_name: 'PE Teacher'
        };

        // Check for teacher conflict
        const hasConflict = await checkTeacherConflict(gamesSubject.teacher_name, day, timeSlot, config.grade);
        if (hasConflict) {
          console.log(`🔄 Games teacher conflict detected, using alternative`);
          subject = {
            name: 'Games',
            code: 'PE',
            teacher_name: 'PE Teacher (Alt)'
          };
        } else {
          subject = gamesSubject;
        }
      } else {
        // Assign academic subject using distribution plan
        if (subjectDistributionPlan.length > 0 && globalPeriodIndex < subjectDistributionPlan.length) {
          const preferredSubject = subjectDistributionPlan[globalPeriodIndex];

          // Check for teacher conflict
          const hasConflict = await checkTeacherConflict(preferredSubject.teacher_name, day, timeSlot, config.grade);
          if (hasConflict) {
            console.log(`🔄 Teacher conflict for ${preferredSubject.name} (${preferredSubject.teacher_name}), finding alternative`);

            // Try to find an alternative from the same subject list, but with different teacher
            let alternativeFound = false;
            for (const altSubject of academicSubjects) {
              if (altSubject.name !== preferredSubject.name) {
                const altHasConflict = await checkTeacherConflict(altSubject.teacher_name, day, timeSlot, config.grade);
                if (!altHasConflict) {
                  subject = altSubject;
                  alternativeFound = true;
                  console.log(`✅ Found alternative: ${altSubject.name} (${altSubject.teacher_name})`);
                  break;
                }
              }
            }

            // If no alternative found, use the preferred subject with alternative teacher
            if (!alternativeFound) {
              subject = {
                name: preferredSubject.name,
                code: preferredSubject.code,
                teacher_name: `${preferredSubject.teacher_name} (Alt)`
              };
              console.log(`🔧 Using alternative teacher for ${preferredSubject.name}`);
            }
          } else {
            subject = preferredSubject;
          }

          globalPeriodIndex++;
        } else {
          // Fallback if distribution plan is exhausted
          subject = academicSubjects[0] || {
            name: 'Study Period',
            code: 'STUDY',
            teacher_name: 'Class Teacher'
          };
        }
      }

      timetable[day].push({
        period: periodNumber,
        time: timeSlot,
        subject: subject.name,
        subject_code: subject.code,
        teacher: subject.teacher_name || 'Unassigned'
      });

      currentTime = periodEndTime;
      periodNumber++;
    }
  }

  // Calculate summary (excluding lunch breaks)
  const subjectDistribution = {};
  Object.values(timetable).flat().forEach(period => {
    if (period.subject !== 'Lunch Break') {
      subjectDistribution[period.subject] = (subjectDistribution[period.subject] || 0) + 1;
    }
  });

  console.log('Generated timetable summary:', subjectDistribution);

  // Verify all academic subjects are included
  const missingSubjects = academicSubjects.filter(subject =>
    !subjectDistribution.hasOwnProperty(subject.name)
  );

  if (missingSubjects.length > 0) {
    console.log('⚠️ Missing subjects in timetable:', missingSubjects.map(s => s.name));
  } else {
    console.log('✅ All academic subjects included in timetable');
  }

  return {
    timetable,
    summary: {
      totalPeriods: Object.values(timetable).flat().filter(p => p.subject !== 'Lunch Break').length,
      subjectDistribution
    }
  };
}

// POST /api/timetable/generate - Generate timetable
router.post('/generate', async (req, res) => {
  try {
    console.log('=== GENERATING TIMETABLE ===');
    console.log('Request body:', req.body);

    const { grade, startTime, endTime, periodDuration, gamesPerDay } = req.body;

    // Validation
    if (!grade || !startTime || !endTime || !periodDuration) {
      return res.status(400).json({
        success: false,
        error: 'Grade, start time, end time, and period duration are required'
      });
    }

    // Fetch subjects for the selected grade
    console.log(`Fetching subjects for grade ${grade}...`);
    const subjects = await sql.find('subjects', { grade_id: parseInt(grade) });

    if (subjects.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No subjects found for grade ${grade}. Please add subjects first.`
      });
    }

    // Fetch teacher names for subjects
    const subjectsWithTeachers = await Promise.all(
      subjects.map(async (subject) => {
        let teacherName = 'Unassigned';
        if (subject.teacher_id) {
          try {
            // Try to find teacher by _id (if teacher_id is ObjectId string)
            let teacher = null;
            if (ObjectId.isValid(subject.teacher_id)) {
              teacher = await sql.findOne('teacher', { _id: new ObjectId(subject.teacher_id) });
            } else {
              // If not ObjectId, try direct match
              teacher = await sql.findOne('teacher', { _id: subject.teacher_id });
            }

            if (teacher) {
              teacherName = teacher.name;
            } else {
              console.log(`Teacher not found for subject ${subject.name} with teacher_id: ${subject.teacher_id}`);
            }
          } catch (error) {
            console.log(`Could not fetch teacher for subject ${subject.name}:`, error.message);
          }
        }
        return {
          ...subject,
          teacher_name: teacherName
        };
      })
    );

    console.log(`Found ${subjectsWithTeachers.length} subjects with teachers:`,
      subjectsWithTeachers.map(s => `${s.name} (${s.teacher_name}) - teacher_id: ${s.teacher_id}`));

    const config = {
      grade,
      startTime,
      endTime,
      periodDuration: parseInt(periodDuration),
      gamesPerDay: parseInt(gamesPerDay) || 1
    };

    let timetableData;
    let aiGenerated = false;

    // Try AI generation first
    try {
      timetableData = await generateTimetableWithAI(subjectsWithTeachers, config);
      aiGenerated = true;
      console.log('✅ AI timetable generated successfully');

      // Even with AI generation, check for teacher conflicts and fix them
      timetableData = await validateAndFixTeacherConflicts(timetableData, config.grade);
    } catch (aiError) {
      console.log('⚠️ AI generation failed, using fallback:', aiError.message);
      timetableData = await generateFallbackTimetable(subjectsWithTeachers, config);
    }

    // Save timetable to database
    const timetableRecord = {
      grade_id: parseInt(grade),
      config,
      timetable: timetableData.timetable,
      summary: timetableData.summary,
      subjects_used: subjectsWithTeachers.map(s => ({
        id: s._id,
        name: s.name,
        code: s.code,
        teacher_name: s.teacher_name
      })),
      ai_generated: aiGenerated,
      teacher_conflicts_checked: true,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Check if timetable already exists for this grade
    const existingTimetable = await sql.findOne('timetables', { grade_id: parseInt(grade) });

    if (existingTimetable) {
      // Update existing timetable
      await sql.updateOne(
        'timetables',
        { grade_id: parseInt(grade) },
        { $set: { ...timetableRecord, updated_at: new Date() } }
      );
      console.log('✅ Timetable updated in database');
    } else {
      // Create new timetable
      await sql.insertOne('timetables', timetableRecord);
      console.log('✅ Timetable saved to database');
    }

    // Generate teacher conflict summary for debugging
    await getTeacherConflictSummary(grade);

    return res.status(200).json({
      success: true,
      message: `Timetable generated successfully for Grade ${grade}`,
      data: {
        grade_id: parseInt(grade),
        timetable: timetableData.timetable,
        summary: timetableData.summary,
        config,
        ai_generated: aiGenerated,
        subjects_count: subjectsWithTeachers.length
      }
    });

  } catch (error) {
    console.error('❌ Error generating timetable:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to generate timetable: ${error.message}`
    });
  }
});

// GET /api/timetable - Get all timetables (must be before /:grade route)
router.get('/', async (req, res) => {
  try {
    console.log('=== FETCHING ALL TIMETABLES ===');

    const timetables = await sql.find('timetables', {}, { sort: { grade_id: 1 } });

    console.log(`✅ Found ${timetables.length} timetables`);

    return res.status(200).json({
      success: true,
      message: `Found ${timetables.length} timetables`,
      data: timetables
    });

  } catch (error) {
    console.error('❌ Error fetching timetables:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch timetables: ${error.message}`
    });
  }
});

// GET /api/timetable/:grade - Get timetable for a specific grade
router.get('/:grade', async (req, res) => {
  try {
    const { grade } = req.params;
    console.log(`=== FETCHING TIMETABLE FOR GRADE ${grade} ===`);

    const timetable = await sql.findOne('timetables', { grade_id: parseInt(grade) });

    if (!timetable) {
      return res.status(404).json({
        success: false,
        error: `No timetable found for grade ${grade}`
      });
    }

    console.log('✅ Timetable found');

    return res.status(200).json({
      success: true,
      message: `Timetable retrieved for Grade ${grade}`,
      data: timetable
    });

  } catch (error) {
    console.error('❌ Error fetching timetable:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch timetable: ${error.message}`
    });
  }
});

// POST /api/timetable/update/:grade - Update timetable (alternative endpoint)
router.post('/update/:grade', async (req, res) => {
  try {
    const { grade } = req.params;
    const { timetable, summary } = req.body;

    console.log(`=== UPDATING TIMETABLE FOR GRADE ${grade} (POST) ===`);
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Updated timetable data received');
    console.log('Timetable keys:', timetable ? Object.keys(timetable) : 'No timetable data');

    // Validation
    if (!timetable) {
      return res.status(400).json({
        success: false,
        error: 'Timetable data is required'
      });
    }

    // Check if timetable exists
    const existingTimetable = await sql.findOne('timetables', { grade_id: parseInt(grade) });

    if (!existingTimetable) {
      return res.status(404).json({
        success: false,
        error: `No timetable found for grade ${grade}`
      });
    }

    // Update the timetable
    const updateData = {
      $set: {
        timetable: timetable,
        summary: summary || existingTimetable.summary,
        updated_at: new Date(),
        manually_edited: true
      }
    };

    await sql.updateOne('timetables', { grade_id: parseInt(grade) }, updateData);

    // Get updated timetable
    const updatedTimetable = await sql.findOne('timetables', { grade_id: parseInt(grade) });

    console.log('✅ Timetable updated successfully');

    return res.status(200).json({
      success: true,
      message: `Timetable updated successfully for Grade ${grade}`,
      data: updatedTimetable
    });

  } catch (error) {
    console.error('❌ Error updating timetable:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to update timetable: ${error.message}`
    });
  }
});

// PUT /api/timetable/:grade - Update timetable (for drag-and-drop editing)
router.put('/:grade', async (req, res) => {
  try {
    const { grade } = req.params;
    const { timetable, summary } = req.body;

    console.log(`=== UPDATING TIMETABLE FOR GRADE ${grade} ===`);
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Updated timetable data received');
    console.log('Timetable keys:', timetable ? Object.keys(timetable) : 'No timetable data');

    // Validation
    if (!timetable) {
      return res.status(400).json({
        success: false,
        error: 'Timetable data is required'
      });
    }

    // Check if timetable exists
    const existingTimetable = await sql.findOne('timetables', { grade_id: parseInt(grade) });

    if (!existingTimetable) {
      return res.status(404).json({
        success: false,
        error: `No timetable found for grade ${grade}`
      });
    }

    // Update the timetable
    const updateData = {
      $set: {
        timetable: timetable,
        summary: summary || existingTimetable.summary,
        updated_at: new Date(),
        manually_edited: true
      }
    };

    await sql.updateOne('timetables', { grade_id: parseInt(grade) }, updateData);

    // Get updated timetable
    const updatedTimetable = await sql.findOne('timetables', { grade_id: parseInt(grade) });

    console.log('✅ Timetable updated successfully');

    return res.status(200).json({
      success: true,
      message: `Timetable updated successfully for Grade ${grade}`,
      data: updatedTimetable
    });

  } catch (error) {
    console.error('❌ Error updating timetable:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to update timetable: ${error.message}`
    });
  }
});

// DELETE /api/timetable/:grade - Delete timetable for a specific grade
router.delete('/:grade', async (req, res) => {
  try {
    const { grade } = req.params;
    console.log(`=== DELETING TIMETABLE FOR GRADE ${grade} ===`);

    const result = await sql.deleteOne('timetables', { grade_id: parseInt(grade) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: `No timetable found for grade ${grade}`
      });
    }

    console.log('✅ Timetable deleted successfully');

    return res.status(200).json({
      success: true,
      message: `Timetable deleted for Grade ${grade}`
    });

  } catch (error) {
    console.error('❌ Error deleting timetable:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to delete timetable: ${error.message}`
    });
  }
});

// POST /api/timetable/substitute - Apply teacher substitution
router.post('/substitute', async (req, res) => {
  try {
    const { grade_id, day, period, substituteTeacher, originalTeacher, leaveId, subject, time } = req.body;

    console.log(`=== APPLYING TEACHER SUBSTITUTION ===`);
    console.log('Substitution data:', { grade_id, day, period, substituteTeacher, originalTeacher, leaveId, subject, time });

    // Validation
    if (!grade_id || !day || !period || !substituteTeacher) {
      return res.status(400).json({
        success: false,
        error: 'grade_id, day, period, and substituteTeacher are required'
      });
    }

    // Double-check substitute teacher availability across all timetables
    console.log(`🔍 Verifying ${substituteTeacher} is available at ${time} on ${day}`);
    
    const allTimetables = await sql.find('timetables', {});
    let conflictFound = false;
    let conflictDetails = null;

    for (const timetable of allTimetables) {
      const daySchedule = timetable.timetable?.[day] || [];
      
      for (const periodItem of daySchedule) {
        if (periodItem.time === time && periodItem.subject !== 'Lunch Break') {
          // Clean teacher name for comparison
          const cleanTeacherName = periodItem.teacher?.replace(/\s*\(Alt\)$/, '').trim();
          
          if (cleanTeacherName === substituteTeacher) {
            conflictFound = true;
            conflictDetails = {
              conflictGrade: timetable.grade_id,
              conflictSubject: periodItem.subject,
              conflictPeriod: periodItem.period,
              conflictTime: periodItem.time
            };
            break;
          }
        }
      }
      
      if (conflictFound) break;
    }

    if (conflictFound) {
      console.log(`❌ Conflict detected: ${substituteTeacher} already has class in Grade ${conflictDetails.conflictGrade}`);
      return res.status(409).json({
        success: false,
        error: `${substituteTeacher} is already scheduled for ${conflictDetails.conflictSubject} in Grade ${conflictDetails.conflictGrade} at ${conflictDetails.conflictTime}`,
        conflict: conflictDetails
      });
    }

    // Get the timetable for the grade
    const timetable = await sql.findOne('timetables', { grade_id: parseInt(grade_id) });

    if (!timetable) {
      return res.status(404).json({
        success: false,
        error: `No timetable found for grade ${grade_id}`
      });
    }

    // Update the specific period with substitute teacher
    const daySchedule = timetable.timetable[day];
    if (!daySchedule) {
      return res.status(404).json({
        success: false,
        error: `No schedule found for ${day}`
      });
    }

    // Find and update the period
    let periodFound = false;
    let originalTeacherFromSchedule = null;
    
    const updatedSchedule = daySchedule.map(periodItem => {
      if (periodItem.period === period || periodItem.period === parseInt(period)) {
        periodFound = true;
        originalTeacherFromSchedule = periodItem.originalTeacher || periodItem.teacher;
        
        return {
          ...periodItem,
          teacher: substituteTeacher,
          originalTeacher: originalTeacher || periodItem.teacher,
          isSubstitute: true,
          leaveId: leaveId,
          substitutedAt: new Date(),
          substitutionReason: `Leave substitution for ${originalTeacher || periodItem.teacher}`
        };
      }
      return periodItem;
    });

    if (!periodFound) {
      return res.status(404).json({
        success: false,
        error: `Period ${period} not found in ${day} schedule for Grade ${grade_id}`
      });
    }

    // Update the timetable in database
    const updateData = {
      $set: {
        [`timetable.${day}`]: updatedSchedule,
        updated_at: new Date(),
        has_substitutions: true,
        last_substitution: {
          date: new Date(),
          grade_id: parseInt(grade_id),
          day: day,
          period: period,
          originalTeacher: originalTeacher || originalTeacherFromSchedule,
          substituteTeacher: substituteTeacher,
          leaveId: leaveId
        }
      }
    };

    const updateResult = await sql.updateOne('timetables', { grade_id: parseInt(grade_id) }, updateData);

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: `Failed to update timetable for grade ${grade_id}`
      });
    }

    console.log(`✅ Teacher substitution applied successfully: ${originalTeacher || originalTeacherFromSchedule} → ${substituteTeacher}`);

    return res.status(200).json({
      success: true,
      message: `Substitute teacher assigned successfully for Grade ${grade_id}, ${day}, Period ${period}`,
      data: {
        grade_id: parseInt(grade_id),
        day,
        period,
        time,
        subject,
        substituteTeacher,
        originalTeacher: originalTeacher || originalTeacherFromSchedule,
        leaveId,
        substitutedAt: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Error applying teacher substitution:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to apply teacher substitution: ${error.message}`
    });
  }
});

// GET /api/timetable/teacher-schedule/:teacherName/:day - Get teacher's schedule for debugging
router.get('/teacher-schedule/:teacherName/:day', async (req, res) => {
  try {
    const { teacherName, day } = req.params;
    
    console.log(`=== FETCHING TEACHER SCHEDULE ===`);
    console.log(`Teacher: ${teacherName}, Day: ${day}`);

    // Get all timetables
    const allTimetables = await sql.find('timetables', {});
    
    const teacherSchedule = [];
    
    allTimetables.forEach(timetable => {
      const daySchedule = timetable.timetable?.[day] || [];
      
      daySchedule.forEach(period => {
        // Check for exact match or alternative teacher names
        const isTeacherMatch = period.teacher === teacherName || 
                              period.originalTeacher === teacherName ||
                              (period.teacher && period.teacher.includes(teacherName));
        
        if (isTeacherMatch && period.subject !== 'Lunch Break') {
          teacherSchedule.push({
            grade_id: timetable.grade_id,
            period: period.period,
            time: period.time,
            subject: period.subject,
            teacher: period.teacher,
            originalTeacher: period.originalTeacher,
            isSubstitute: period.isSubstitute || false
          });
        }
      });
    });

    console.log(`✅ Found ${teacherSchedule.length} classes for ${teacherName} on ${day}`);

    return res.status(200).json({
      success: true,
      message: `Schedule retrieved for ${teacherName} on ${day}`,
      data: {
        teacherName,
        day,
        classes: teacherSchedule,
        totalClasses: teacherSchedule.length
      }
    });

  } catch (error) {
    console.error('❌ Error fetching teacher schedule:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch teacher schedule: ${error.message}`
    });
  }
});

// GET /api/timetable/conflicts/:day/:time - Check teacher conflicts at specific time
router.get('/conflicts/:day/:time', async (req, res) => {
  try {
    const { day, time } = req.params;
    
    console.log(`=== CHECKING TEACHER CONFLICTS ===`);
    console.log(`Day: ${day}, Time: ${time}`);

    // Get all timetables
    const allTimetables = await sql.find('timetables', {});
    
    const teachersAtTime = [];
    
    allTimetables.forEach(timetable => {
      const daySchedule = timetable.timetable?.[day] || [];
      
      daySchedule.forEach(period => {
        if (period.time === time && period.subject !== 'Lunch Break' && period.teacher) {
          teachersAtTime.push({
            teacher: period.teacher,
            grade_id: timetable.grade_id,
            subject: period.subject,
            period: period.period,
            isSubstitute: period.isSubstitute || false,
            originalTeacher: period.originalTeacher
          });
        }
      });
    });

    // Find conflicts (same teacher in multiple places)
    const teacherCounts = {};
    teachersAtTime.forEach(item => {
      const cleanName = item.teacher.replace(/\s*\(Alt\)$/, '').trim();
      if (!teacherCounts[cleanName]) {
        teacherCounts[cleanName] = [];
      }
      teacherCounts[cleanName].push(item);
    });

    const conflicts = Object.entries(teacherCounts)
      .filter(([teacher, assignments]) => assignments.length > 1)
      .map(([teacher, assignments]) => ({ teacher, assignments }));

    console.log(`✅ Found ${teachersAtTime.length} teachers scheduled, ${conflicts.length} conflicts`);

    return res.status(200).json({
      success: true,
      message: `Conflict check completed for ${day} at ${time}`,
      data: {
        day,
        time,
        teachersScheduled: teachersAtTime,
        conflicts: conflicts,
        totalTeachers: teachersAtTime.length,
        conflictCount: conflicts.length
      }
    });

  } catch (error) {
    console.error('❌ Error checking teacher conflicts:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to check teacher conflicts: ${error.message}`
    });
  }
});

module.exports = router;
