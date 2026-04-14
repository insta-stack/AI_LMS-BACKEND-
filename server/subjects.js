const express = require('express');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const router = express.Router();

// Import the MongoDB database connection
const sql = require('../../db.js');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI('AIzaSyDkqPqcSFM88_8m9FQCSjyfAUSjYiTezhI');

// Configure multer for curriculum file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/curriculum';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow common document formats
    const allowedTypes = /\.(pdf|doc|docx|txt|rtf)$/i;
    const extname = allowedTypes.test(path.extname(file.originalname));
    const mimetype = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/(plain|rtf))$/.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, TXT, and RTF files are allowed'));
    }
  }
});

// GET /api/subjects - Get all subjects
router.get('/', async (req, res) => {
  try {
    console.log('=== FETCHING ALL SUBJECTS ===');

    const { grade_id, search } = req.query;
    let query = {};

    // Filter by grade if specified
    if (grade_id) {
      query.grade_id = grade_id;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const subjects = await sql.find('subjects', query, { 
      sort: { grade_id: 1, name: 1 } 
    });

    console.log(`✅ Found ${subjects.length} subjects`);

    // Enhance subjects with grade information
    const enhancedSubjects = await Promise.all(
      subjects.map(async (subject) => {
        let gradeInfo = null;
        if (subject.grade_id) {
          try {
            const grade = await sql.findOne('grade', { id: subject.grade_id });
            if (grade) {
              gradeInfo = {
                id: grade.id,
                name: grade.gradename || grade.name
              };
            }
          } catch (error) {
            console.log(`Grade not found for subject ${subject.name}`);
          }
        }
        
        return {
          ...subject,
          grade: gradeInfo
        };
      })
    );

    return res.status(200).json(enhancedSubjects);

  } catch (error) {
    console.error('❌ Error fetching subjects:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch subjects: ${error.message}`
    });
  }
});

// GET /api/subjects/stats - Get subjects statistics
router.get('/stats/overview', async (req, res) => {
  try {
    console.log('=== FETCHING SUBJECTS STATISTICS ===');

    const subjects = await sql.find('subjects', {});
    const grades = await sql.find('grade', {});

    // Calculate statistics
    const totalSubjects = subjects.length;
    const activeSubjects = subjects.filter(s => s.status === 'active').length;
    const subjectsWithCurriculum = subjects.filter(s => s.curriculum_file).length;
    const totalGrades = grades.length;

    // Group subjects by grade
    const subjectsByGrade = {};
    subjects.forEach(subject => {
      const gradeId = subject.grade_id;
      if (!subjectsByGrade[gradeId]) {
        subjectsByGrade[gradeId] = [];
      }
      subjectsByGrade[gradeId].push(subject);
    });

    const stats = {
      totalSubjects,
      activeSubjects,
      subjectsWithCurriculum,
      totalGrades,
      averageSubjectsPerGrade: totalGrades > 0 ? Math.round(totalSubjects / totalGrades) : 0,
      curriculumCompletionRate: totalSubjects > 0 ? Math.round((subjectsWithCurriculum / totalSubjects) * 100) : 0,
      subjectsByGrade: Object.keys(subjectsByGrade).map(gradeId => ({
        gradeId,
        count: subjectsByGrade[gradeId].length
      }))
    };

    console.log('✅ Statistics calculated:', stats);
    return res.status(200).json(stats);

  } catch (error) {
    console.error('❌ Error fetching statistics:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch statistics: ${error.message}`
    });
  }
});

// GET /api/subjects/:id - Get a specific subject
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`=== FETCHING SUBJECT ${id} ===`);

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    const subject = await sql.findOne('subjects', query);

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    // Get grade information
    let gradeInfo = null;
    if (subject.grade_id) {
      try {
        const grade = await sql.findOne('grade', { id: subject.grade_id });
        if (grade) {
          gradeInfo = {
            id: grade.id,
            name: grade.gradename || grade.name
          };
        }
      } catch (error) {
        console.log(`Grade not found for subject ${subject.name}`);
      }
    }

    const enhancedSubject = {
      ...subject,
      grade: gradeInfo
    };

    console.log('✅ Subject found:', enhancedSubject);
    return res.status(200).json(enhancedSubject);

  } catch (error) {
    console.error('❌ Error fetching subject:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch subject: ${error.message}`
    });
  }
});

// POST /api/subjects - Create a new subject
router.post('/', async (req, res) => {
  try {
    console.log('=== CREATING NEW SUBJECT ===');
    console.log('Request body:', req.body);

    const { name, code, description, grade_id, credits, teacher_id } = req.body;

    // Validation
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        error: 'Subject name and code are required'
      });
    }

    // Check if subject code already exists for the same grade
    const existingSubject = await sql.findOne('subjects', { 
      code: code,
      grade_id: grade_id 
    });

    if (existingSubject) {
      return res.status(409).json({
        success: false,
        error: 'Subject code already exists for this grade'
      });
    }

    // Create new subject
    const subjectData = {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description ? description.trim() : '',
      grade_id: grade_id ? parseInt(grade_id) : null,
      grade: grade_id ? parseInt(grade_id) : null, // Add grade field for compatibility
      credits: credits ? parseInt(credits) : 1,
      teacher_id: teacher_id || null,
      curriculum_file: null,
      curriculum_filename: null,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await sql.insertOne('subjects', subjectData);
    const insertedSubject = await sql.findOne('subjects', { _id: result.insertedId });

    // Get grade information
    let gradeInfo = null;
    if (insertedSubject.grade_id) {
      try {
        const grade = await sql.findOne('grade', { id: insertedSubject.grade_id });
        if (grade) {
          gradeInfo = {
            id: grade.id,
            name: grade.gradename || grade.name
          };
        }
      } catch (error) {
        console.log(`Grade not found for subject ${insertedSubject.name}`);
      }
    }

    const enhancedSubject = {
      ...insertedSubject,
      grade: gradeInfo
    };

    console.log('✅ Subject created successfully:', enhancedSubject);

    return res.status(201).json({
      success: true,
      message: 'Subject created successfully',
      data: enhancedSubject
    });

  } catch (error) {
    console.error('❌ Error creating subject:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to create subject: ${error.message}`
    });
  }
});

// PUT /api/subjects/:id - Update a subject
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, grade_id, credits, teacher_id, status } = req.body;

    console.log(`=== UPDATING SUBJECT ${id} ===`);
    console.log('Update data:', req.body);

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    // Check if subject exists
    const existingSubject = await sql.findOne('subjects', query);
    if (!existingSubject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    // Check if new code conflicts with existing subjects (excluding current subject)
    if (code && code !== existingSubject.code) {
      const conflictSubject = await sql.findOne('subjects', {
        code: code.trim().toUpperCase(),
        grade_id: grade_id || existingSubject.grade_id,
        _id: { $ne: existingSubject._id }
      });

      if (conflictSubject) {
        return res.status(409).json({
          success: false,
          error: 'Subject code already exists for this grade'
        });
      }
    }

    // Update subject
    const updateData = {
      $set: {
        updated_at: new Date()
      }
    };

    if (name) updateData.$set.name = name.trim();
    if (code) updateData.$set.code = code.trim().toUpperCase();
    if (description !== undefined) updateData.$set.description = description.trim();
    if (grade_id) {
      updateData.$set.grade_id = parseInt(grade_id);
      updateData.$set.grade = parseInt(grade_id); // Add grade field for compatibility
    }
    if (credits) updateData.$set.credits = parseInt(credits);
    if (teacher_id !== undefined) updateData.$set.teacher_id = teacher_id;
    if (status) updateData.$set.status = status;

    await sql.updateOne('subjects', query, updateData);

    // Get updated subject
    const updatedSubject = await sql.findOne('subjects', query);

    // Get grade information
    let gradeInfo = null;
    if (updatedSubject.grade_id) {
      try {
        const grade = await sql.findOne('grade', { id: updatedSubject.grade_id });
        if (grade) {
          gradeInfo = {
            id: grade.id,
            name: grade.gradename || grade.name
          };
        }
      } catch (error) {
        console.log(`Grade not found for subject ${updatedSubject.name}`);
      }
    }

    const enhancedSubject = {
      ...updatedSubject,
      grade: gradeInfo
    };

    console.log('✅ Subject updated successfully:', enhancedSubject);

    return res.status(200).json({
      success: true,
      message: 'Subject updated successfully',
      data: enhancedSubject
    });

  } catch (error) {
    console.error('❌ Error updating subject:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to update subject: ${error.message}`
    });
  }
});

// Helper function to extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

// Helper function to generate educational content using Gemini AI
async function generateEducationalContent(pdfText, subjectName, gradeName) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
You are an educational content creator for kids. Analyze the following curriculum content for ${subjectName} (${gradeName}) and create engaging educational materials.

CURRICULUM TEXT:
${pdfText.substring(0, 8000)} // Limit text to avoid token limits

Please provide a JSON response with the following structure:
{
  "chapters": [
    {
      "name": "Chapter Title",
      "summary": "Brief summary for kids",
      "keyTopics": ["topic1", "topic2", "topic3"],
      "learningObjectives": ["objective1", "objective2"]
    }
  ],
  "questionnaire": [
    {
      "question": "Question text suitable for the grade level",
      "type": "multiple_choice",
      "options": ["A) option1", "B) option2", "C) option3", "D) option4"],
      "correct_answer": "A",
      "explanation": "Why this is correct"
    },
    {
      "question": "Another question",
      "type": "short_answer",
      "sample_answer": "Expected answer",
      "explanation": "What to look for in the answer"
    }
  ],
  "funFacts": [
    "Interesting fact 1 related to the curriculum",
    "Interesting fact 2 that kids would enjoy"
  ],
  "activities": [
    {
      "title": "Activity Name",
      "description": "Fun activity description",
      "materials": ["material1", "material2"],
      "instructions": ["step1", "step2", "step3"]
    }
  ]
}

Make sure the content is age-appropriate for the grade level and engaging for children. Focus on making learning fun and interactive.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Try to parse JSON, if it fails, create a basic structure
    try {
      return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      // Return a basic structure if JSON parsing fails
      return {
        chapters: [{
          name: "Generated Content",
          summary: "AI-generated educational content",
          keyTopics: ["Key concepts from the curriculum"],
          learningObjectives: ["Understanding the subject matter"]
        }],
        questionnaire: [{
          question: "What is the main topic of this curriculum?",
          type: "short_answer",
          sample_answer: "Based on the curriculum content",
          explanation: "This tests basic understanding"
        }],
        funFacts: ["This curriculum contains valuable educational content"],
        activities: [{
          title: "Study Activity",
          description: "Review the curriculum content",
          materials: ["Textbook", "Notes"],
          instructions: ["Read carefully", "Take notes", "Ask questions"]
        }]
      };
    }
  } catch (error) {
    console.error('Error generating educational content:', error);
    throw new Error('Failed to generate educational content');
  }
}

// POST /api/subjects/:id/curriculum - Upload curriculum file
router.post('/:id/curriculum', upload.single('curriculum'), async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`=== UPLOADING CURRICULUM FOR SUBJECT ${id} ===`);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No curriculum file provided'
      });
    }

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    // Check if subject exists
    const existingSubject = await sql.findOne('subjects', query);
    if (!existingSubject) {
      // Delete uploaded file if subject doesn't exist
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    // Delete old curriculum file if exists
    if (existingSubject.curriculum_file) {
      const oldFilePath = path.join('uploads/curriculum', existingSubject.curriculum_file);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    // Update subject with new curriculum file
    const updateData = {
      $set: {
        curriculum_file: req.file.filename,
        curriculum_filename: req.file.originalname,
        updated_at: new Date()
      }
    };

    await sql.updateOne('subjects', query, updateData);

    // Get updated subject
    const updatedSubject = await sql.findOne('subjects', query);

    console.log('✅ Curriculum uploaded successfully');

    return res.status(200).json({
      success: true,
      message: 'Curriculum uploaded successfully',
      data: {
        curriculum_file: updatedSubject.curriculum_file,
        curriculum_filename: updatedSubject.curriculum_filename
      }
    });

  } catch (error) {
    console.error('❌ Error uploading curriculum:', error);
    
    // Delete uploaded file on error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      success: false,
      error: `Failed to upload curriculum: ${error.message}`
    });
  }
});

// POST /api/subjects/:id/curriculum-ai - Upload curriculum file with AI processing
router.post('/:id/curriculum-ai', (req, res, next) => {
  // Handle multer errors
  upload.single('curriculum')(req, res, function (err) {
    if (err) {
      console.error('❌ Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File too large. Maximum size is 10MB.'
        });
      }
      if (err.message.includes('Only PDF, DOC, DOCX, TXT, and RTF files are allowed')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid file type. Only PDF, DOC, DOCX, TXT, and RTF files are allowed.'
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message || 'File upload error'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`=== UPLOADING CURRICULUM WITH AI PROCESSING FOR SUBJECT ${id} ===`);
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    console.log('Request headers:', req.headers);

    if (!req.file) {
      console.log('❌ No file found in request');
      return res.status(400).json({
        success: false,
        error: 'No curriculum file provided'
      });
    }

    console.log('✅ File received:', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    // Check if subject exists
    const existingSubject = await sql.findOne('subjects', query);
    if (!existingSubject) {
      // Delete uploaded file if subject doesn't exist
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    // Get grade information for AI context
    let gradeInfo = 'Unknown Grade';
    if (existingSubject.grade_id) {
      try {
        const grade = await sql.findOne('grade', { id: existingSubject.grade_id });
        if (grade) {
          gradeInfo = grade.gradename || grade.name || `Grade ${grade.id}`;
        }
      } catch (error) {
        console.log('Could not fetch grade information');
      }
    }

    let aiContent = null;
    let pdfText = '';

    // Process PDF file if it's a PDF
    if (req.file.mimetype === 'application/pdf') {
      try {
        console.log('📄 Extracting text from PDF...');
        pdfText = await extractTextFromPDF(req.file.path);
        
        if (pdfText && pdfText.trim().length > 0) {
          console.log('🤖 Generating educational content with AI...');
          aiContent = await generateEducationalContent(pdfText, existingSubject.name, gradeInfo);
          console.log('✅ AI content generated successfully');
        }
      } catch (aiError) {
        console.error('⚠️ AI processing failed:', aiError);
        // Continue with file upload even if AI processing fails
      }
    }

    // Delete old curriculum file if exists
    if (existingSubject.curriculum_file) {
      const oldFilePath = path.join('uploads/curriculum', existingSubject.curriculum_file);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    // Update subject with new curriculum file and AI-generated content
    const updateData = {
      $set: {
        curriculum_file: req.file.filename,
        curriculum_filename: req.file.originalname,
        ai_generated_content: aiContent,
        pdf_text: pdfText ? pdfText.substring(0, 5000) : null, // Store first 5000 chars
        updated_at: new Date()
      }
    };

    await sql.updateOne('subjects', query, updateData);

    // Get updated subject
    const updatedSubject = await sql.findOne('subjects', query);

    console.log('✅ Curriculum uploaded and processed successfully');

    return res.status(200).json({
      success: true,
      message: 'Curriculum uploaded and AI content generated successfully',
      data: {
        curriculum_file: updatedSubject.curriculum_file,
        curriculum_filename: updatedSubject.curriculum_filename,
        ai_content_generated: aiContent !== null,
        ai_generated_content: aiContent,
        chapters_found: aiContent?.chapters?.length || 0,
        questions_generated: aiContent?.questionnaire?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ Error uploading curriculum with AI:', error);
    
    // Delete uploaded file on error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (deleteError) {
        console.error('Error deleting uploaded file:', deleteError);
      }
    }

    return res.status(500).json({
      success: false,
      error: `Failed to upload curriculum: ${error.message}`
    });
  }
});

// GET /api/subjects/:id/curriculum - Download curriculum file
router.get('/:id/curriculum', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`=== DOWNLOADING CURRICULUM FOR SUBJECT ${id} ===`);

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    const subject = await sql.findOne('subjects', query);

    if (!subject || !subject.curriculum_file) {
      return res.status(404).json({
        success: false,
        error: 'Curriculum file not found'
      });
    }

    const filePath = path.join('uploads/curriculum', subject.curriculum_file);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Curriculum file not found on server'
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Disposition', `attachment; filename="${subject.curriculum_filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Send file
    res.sendFile(path.resolve(filePath));

  } catch (error) {
    console.error('❌ Error downloading curriculum:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to download curriculum: ${error.message}`
    });
  }
});

// GET /api/subjects/:id/ai-content - Get AI-generated educational content
router.get('/:id/ai-content', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`=== FETCHING AI CONTENT FOR SUBJECT ${id} ===`);

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    const subject = await sql.findOne('subjects', query);

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    if (!subject.ai_generated_content) {
      return res.status(404).json({
        success: false,
        error: 'No AI-generated content found for this subject'
      });
    }

    console.log('✅ AI content retrieved successfully');

    return res.status(200).json({
      success: true,
      message: 'AI-generated content retrieved successfully',
      data: {
        subject_id: subject._id,
        subject_name: subject.name,
        subject_code: subject.code,
        curriculum_filename: subject.curriculum_filename,
        ai_generated_content: subject.ai_generated_content,
        generated_at: subject.updated_at
      }
    });

  } catch (error) {
    console.error('❌ Error fetching AI content:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch AI content: ${error.message}`
    });
  }
});

// DELETE /api/subjects/:id - Delete a subject
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`=== DELETING SUBJECT ${id} ===`);

    // Convert string ID to ObjectId if valid
    let query = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    }

    // Get subject to delete curriculum file
    const subject = await sql.findOne('subjects', query);
    
    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    // Delete curriculum file if exists
    if (subject.curriculum_file) {
      const filePath = path.join('uploads/curriculum', subject.curriculum_file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete subject
    const result = await sql.deleteOne('subjects', query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    console.log('✅ Subject deleted successfully');

    return res.status(200).json({
      success: true,
      message: 'Subject deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting subject:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to delete subject: ${error.message}`
    });
  }
});

// GET /api/subjects/stats - Get subjects statistics
router.get('/stats/overview', async (req, res) => {
  try {
    console.log('=== FETCHING SUBJECTS STATISTICS ===');

    const subjects = await sql.find('subjects', {});
    const grades = await sql.find('grade', {});

    // Calculate statistics
    const totalSubjects = subjects.length;
    const activeSubjects = subjects.filter(s => s.status === 'active').length;
    const subjectsWithCurriculum = subjects.filter(s => s.curriculum_file).length;
    const totalGrades = grades.length;

    // Group subjects by grade
    const subjectsByGrade = {};
    subjects.forEach(subject => {
      const gradeId = subject.grade_id;
      if (!subjectsByGrade[gradeId]) {
        subjectsByGrade[gradeId] = [];
      }
      subjectsByGrade[gradeId].push(subject);
    });

    const stats = {
      totalSubjects,
      activeSubjects,
      subjectsWithCurriculum,
      totalGrades,
      averageSubjectsPerGrade: totalGrades > 0 ? Math.round(totalSubjects / totalGrades) : 0,
      curriculumCompletionRate: totalSubjects > 0 ? Math.round((subjectsWithCurriculum / totalSubjects) * 100) : 0,
      subjectsByGrade: Object.keys(subjectsByGrade).map(gradeId => ({
        gradeId,
        count: subjectsByGrade[gradeId].length
      }))
    };

    console.log('✅ Statistics calculated:', stats);
    return res.status(200).json(stats);

  } catch (error) {
    console.error('❌ Error fetching statistics:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch statistics: ${error.message}`
    });
  }
});

module.exports = router;
