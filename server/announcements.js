const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { ObjectId } = require('mongodb');
const sql = require('../db.js');

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads/announcements');
fs.ensureDirSync(uploadsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `announcement-${uniqueSuffix}${extension}`);
    }
});

// File filter for images and videos
const fileFilter = (req, file, cb) => {
    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const allowedVideoTypes = ['video/mp4', 'video/webm'];
    const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPG, PNG images and MP4, WEBM videos are allowed.'), false);
    }
};

// Configure multer with size limits
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware to verify admin authentication
const verifyAdmin = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

        if (decoded.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
};

// POST /api/announcements - Create new announcement
router.post('/', verifyAdmin, upload.single('media'), async (req, res) => {
    try {
        console.log('=== CREATE ANNOUNCEMENT REQUEST ===');
        console.log('Request body:', req.body);
        console.log('Uploaded file:', req.file);

        const { caption, targetAudience } = req.body;

        // Validation
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Media file is required'
            });
        }

        if (!caption || !caption.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Caption is required'
            });
        }

        if (!targetAudience) {
            return res.status(400).json({
                success: false,
                message: 'Target audience is required'
            });
        }

        // Determine media type
        const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';

        // Generate media URL (relative path for serving)
        const mediaUrl = `/uploads/announcements/${req.file.filename}`;

        // Parse target audience
        let target = {
            teacher: false,
            student: false,
            staff: false
        };

        if (targetAudience === 'all') {
            target = {
                teacher: true,
                student: true,
                staff: true
            };
        } else if (['teacher', 'student', 'staff'].includes(targetAudience)) {
            target[targetAudience] = true;
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid target audience. Must be "all", "teacher", "student", or "staff"'
            });
        }

        // Create announcement document
        const announcement = {
            _id: new ObjectId(),
            mediaType,
            mediaUrl,
            caption: caption.trim(),
            target,
            createdAt: new Date(),
            expiresAt: null, // Can be set for auto-expiring announcements
            createdBy: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email
            }
        };

        console.log('Creating announcement:', announcement);

        // Insert into MongoDB using the helper method
        const result = await sql.insertOne('announcements', announcement);

        console.log('✅ Announcement created successfully:', result.insertedId);

        return res.status(201).json({
            success: true,
            message: 'Announcement created successfully',
            data: {
                id: result.insertedId,
                ...announcement
            }
        });

    } catch (error) {
        console.error('❌ Error creating announcement:', error);

        // Clean up uploaded file if database operation failed
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up file:', unlinkError);
            }
        }

        return res.status(500).json({
            success: false,
            message: `Failed to create announcement: ${error.message}`,
            error: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// GET /api/announcements/:role - Fetch announcements for specific role
router.get('/:role', async (req, res) => {
    try {
        console.log('=== FETCH ANNOUNCEMENTS REQUEST ===');
        const { role } = req.params;
        console.log('Requested role:', role);

        // Validate role
        if (!['teacher', 'student', 'staff', 'all'].includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Must be teacher, student, staff, or all'
            });
        }

        // Build query based on role
        let query = {};
        if (role !== 'all') {
            query[`target.${role}`] = true;
        }

        // Add expiration filter (exclude expired announcements)
        query.$or = [
            { expiresAt: null },
            { expiresAt: { $gt: new Date() } }
        ];

        console.log('MongoDB query:', query);

        // Fetch announcements from MongoDB
        const announcements = await sql.find('announcements', query, { sort: { createdAt: -1 } });

        console.log(`✅ Found ${announcements.length} announcements for role: ${role}`);

        // Transform data for frontend
        const transformedAnnouncements = announcements.map(announcement => ({
            id: announcement._id,
            mediaType: announcement.mediaType,
            mediaUrl: announcement.mediaUrl,
            caption: announcement.caption,
            target: announcement.target,
            createdAt: announcement.createdAt,
            expiresAt: announcement.expiresAt,
            createdBy: announcement.createdBy
        }));

        return res.status(200).json({
            success: true,
            message: `Successfully fetched ${announcements.length} announcements`,
            data: transformedAnnouncements,
            count: announcements.length
        });

    } catch (error) {
        console.error('❌ Error fetching announcements:', error);
        return res.status(500).json({
            success: false,
            message: `Failed to fetch announcements: ${error.message}`,
            error: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// GET /api/announcements - Fetch all announcements (admin only)
router.get('/', verifyAdmin, async (req, res) => {
    try {
        console.log('=== FETCH ALL ANNOUNCEMENTS REQUEST ===');

        const announcements = await sql.find('announcements', {}, { sort: { createdAt: -1 } });

        console.log(`✅ Found ${announcements.length} total announcements`);

        const transformedAnnouncements = announcements.map(announcement => ({
            id: announcement._id,
            mediaType: announcement.mediaType,
            mediaUrl: announcement.mediaUrl,
            caption: announcement.caption,
            target: announcement.target,
            createdAt: announcement.createdAt,
            expiresAt: announcement.expiresAt,
            createdBy: announcement.createdBy
        }));

        return res.status(200).json({
            success: true,
            message: `Successfully fetched ${announcements.length} announcements`,
            data: transformedAnnouncements,
            count: announcements.length
        });

    } catch (error) {
        console.error('❌ Error fetching all announcements:', error);
        return res.status(500).json({
            success: false,
            message: `Failed to fetch announcements: ${error.message}`,
            error: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// DELETE /api/announcements/:id - Delete announcement (admin only)
router.delete('/:id', verifyAdmin, async (req, res) => {
    try {
        console.log('=== DELETE ANNOUNCEMENT REQUEST ===');
        const { id } = req.params;
        console.log('Announcement ID to delete:', id);

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid announcement ID'
            });
        }

        // Find the announcement first to get media file path
        const announcement = await sql.findOne('announcements', { _id: new ObjectId(id) });

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: 'Announcement not found'
            });
        }

        // Delete the announcement from database
        const result = await sql.deleteOne('announcements', { _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Announcement not found'
            });
        }

        // Clean up media file
        if (announcement.mediaUrl) {
            const filePath = path.join(__dirname, '../../', announcement.mediaUrl);
            try {
                await fs.unlink(filePath);
                console.log('✅ Media file deleted:', filePath);
            } catch (fileError) {
                console.warn('⚠️ Could not delete media file:', fileError.message);
            }
        }

        console.log('✅ Announcement deleted successfully');

        return res.status(200).json({
            success: true,
            message: 'Announcement deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error deleting announcement:', error);
        return res.status(500).json({
            success: false,
            message: `Failed to delete announcement: ${error.message}`,
            error: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// PUT /api/announcements/:id - Update announcement (admin only)
router.put('/:id', verifyAdmin, upload.single('media'), async (req, res) => {
    try {
        console.log('=== UPDATE ANNOUNCEMENT REQUEST ===');
        const { id } = req.params;
        const { caption, targetAudience } = req.body;
        console.log('Announcement ID to update:', id);
        console.log('Update data:', req.body);
        console.log('New file:', req.file);

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid announcement ID'
            });
        }

        // Find existing announcement
        const existingAnnouncement = await sql.findOne('announcements', { _id: new ObjectId(id) });

        if (!existingAnnouncement) {
            return res.status(404).json({
                success: false,
                message: 'Announcement not found'
            });
        }

        // Prepare update data
        const updateData = {
            updatedAt: new Date()
        };

        // Update caption if provided
        if (caption && caption.trim()) {
            updateData.caption = caption.trim();
        }

        // Update target audience if provided
        if (targetAudience) {
            let target = {
                teacher: false,
                student: false,
                staff: false
            };

            if (targetAudience === 'all') {
                target = {
                    teacher: true,
                    student: true,
                    staff: true
                };
            } else if (['teacher', 'student', 'staff'].includes(targetAudience)) {
                target[targetAudience] = true;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid target audience'
                });
            }

            updateData.target = target;
        }

        // Update media if new file uploaded
        if (req.file) {
            const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
            const mediaUrl = `/uploads/announcements/${req.file.filename}`;

            updateData.mediaType = mediaType;
            updateData.mediaUrl = mediaUrl;

            // Delete old media file
            if (existingAnnouncement.mediaUrl) {
                const oldFilePath = path.join(__dirname, '../../', existingAnnouncement.mediaUrl);
                try {
                    await fs.unlink(oldFilePath);
                    console.log('✅ Old media file deleted');
                } catch (fileError) {
                    console.warn('⚠️ Could not delete old media file:', fileError.message);
                }
            }
        }

        // Update announcement in database
        const result = await sql.updateOne('announcements',
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Announcement not found'
            });
        }

        // Fetch updated announcement
        const updatedAnnouncement = await sql.findOne('announcements', { _id: new ObjectId(id) });

        console.log('✅ Announcement updated successfully');

        return res.status(200).json({
            success: true,
            message: 'Announcement updated successfully',
            data: {
                id: updatedAnnouncement._id,
                mediaType: updatedAnnouncement.mediaType,
                mediaUrl: updatedAnnouncement.mediaUrl,
                caption: updatedAnnouncement.caption,
                target: updatedAnnouncement.target,
                createdAt: updatedAnnouncement.createdAt,
                updatedAt: updatedAnnouncement.updatedAt,
                createdBy: updatedAnnouncement.createdBy
            }
        });

    } catch (error) {
        console.error('❌ Error updating announcement:', error);

        // Clean up new uploaded file if database operation failed
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up new file:', unlinkError);
            }
        }

        return res.status(500).json({
            success: false,
            message: `Failed to update announcement: ${error.message}`,
            error: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 10MB.'
            });
        }
    }

    if (error.message.includes('Invalid file type')) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    next(error);
});

module.exports = router;
