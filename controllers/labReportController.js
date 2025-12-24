import { query, transaction } from '../config/database.js';
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  getCloudinaryUrl,
} from '../middleware/upload.js';
import { extractTestsFromImage } from '../services/ocrServices.js';

/* =========================================================
   GET ALL LAB REPORTS (PAGINATED)
========================================================= */
export const getLabReports = async (req, res) => {
  try {
    const userId = req.user?.userId || "c0d655a2-57b6-4f97-97c5-165708225700";
    const { page = 1, limit = 10, sortBy = 'report_date', order = 'DESC' } =
      req.query;

    const offset = (page - 1) * limit;

    const reportsResult = await query(
      `
      SELECT lr.*, COUNT(lt.id) AS test_count
      FROM lab_reports lr
      LEFT JOIN lab_tests lt ON lr.id = lt.report_id
      WHERE lr.user_id = $1
      GROUP BY lr.id
      ORDER BY ${sortBy} ${order}
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    const reports = reportsResult.rows.map((report) => {
      if (report.image_key) {
        report.image_url = getCloudinaryUrl(report.image_key);
      }
      return report;
    });

    const countResult = await query(
      'SELECT COUNT(*) FROM lab_reports WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      data: reports,
      pagination: {
        total: Number(countResult.rows[0].count),
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reports' });
  }
};

/* =========================================================
   GET SINGLE LAB REPORT
========================================================= */
export const getLabReportById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const reportResult = await query(
      'SELECT * FROM lab_reports WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!reportResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const report = reportResult.rows[0];

    if (report.image_key) {
      report.image_url = getCloudinaryUrl(report.image_key);
    }

    const testsResult = await query(
      'SELECT * FROM lab_tests WHERE report_id = $1 ORDER BY order_index ASC',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...report,
        tests: testsResult.rows,
      },
    });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report' });
  }
};

/* =========================================================
   CREATE LAB REPORT
========================================================= */
export const createLabReport = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { lab_name, report_date, notes, status = 'draft' } = req.body;

    const result = await query(
      `
      INSERT INTO lab_reports (user_id, lab_name, report_date, notes, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [userId, lab_name, report_date, notes, status]
    );

    res.status(201).json({
      success: true,
      message: 'Lab report created',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ success: false, message: 'Failed to create report' });
  }
};

/* =========================================================
   UPLOAD IMAGE + OCR
========================================================= */
export const uploadReportImage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image required' });
    }

    const reportResult = await query(
      'SELECT image_key FROM lab_reports WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!reportResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const oldImageKey = reportResult.rows[0].image_key;

    // Delete old image
    if (oldImageKey) {
      await deleteFromCloudinary(oldImageKey);
    }

    // Uploaded automatically by multer
    const { url, key } = await uploadToCloudinary(req.file, userId);

    // OCR extraction (multer-storage-cloudinary DOES NOT keep buffer)
    // 👉 So OCR must use Cloudinary image URL instead OR uploadBuffer middleware
    const start = Date.now();
    const ocrResult = await extractTestsFromImage(url);
    const processingTime = Date.now() - start;

    await transaction(async (client) => {
      await client.query(
        'UPDATE lab_reports SET image_url = $1, image_key = $2 WHERE id = $3',
        [url, key, id]
      );

      await client.query(
        `
        INSERT INTO ocr_logs
        (report_id, image_url, extracted_text, tests_extracted, status, processing_time_ms)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          id,
          url,
          JSON.stringify(ocrResult.tests || []),
          ocrResult.count || 0,
          ocrResult.success ? 'success' : 'failed',
          processingTime,
        ]
      );

      if (ocrResult.success && ocrResult.tests?.length) {
        for (let i = 0; i < ocrResult.tests.length; i++) {
          const test = ocrResult.tests[i];
          await client.query(
            `
            INSERT INTO lab_tests
            (report_id, test_name, value, unit, normal_range, order_index)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
              id,
              test.testName,
              test.value,
              test.unit,
              test.normalRange,
              i,
            ]
          );
        }
      }
    });

    res.json({
      success: true,
      message: 'Image uploaded & OCR completed',
      data: {
        image_url: url,
        tests_extracted: ocrResult.count || 0,
        processing_time_ms: processingTime,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

/* =========================================================
   UPDATE LAB REPORT
========================================================= */
export const updateLabReport = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { lab_name, report_date, notes, status } = req.body;

    const result = await query(
      `
      UPDATE lab_reports
      SET lab_name = COALESCE($1, lab_name),
          report_date = COALESCE($2, report_date),
          notes = COALESCE($3, notes),
          status = COALESCE($4, status)
      WHERE id = $5 AND user_id = $6
      RETURNING *
      `,
      [lab_name, report_date, notes, status, id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

/* =========================================================
   DELETE LAB REPORT
========================================================= */
export const deleteLabReport = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      'SELECT image_key FROM lab_reports WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    if (result.rows[0].image_key) {
      await deleteFromCloudinary(result.rows[0].image_key);
    }

    await query('DELETE FROM lab_reports WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ]);

    res.json({ success: true, message: 'Report deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
};

/* =========================================================
   UPDATE TESTS MANUALLY
========================================================= */
export const updateTests = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { tests } = req.body;

    if (!Array.isArray(tests)) {
      return res.status(400).json({ success: false, message: 'Invalid tests' });
    }

    const reportCheck = await query(
      'SELECT id FROM lab_reports WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!reportCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    await transaction(async (client) => {
      await client.query('DELETE FROM lab_tests WHERE report_id = $1', [id]);

      for (let i = 0; i < tests.length; i++) {
        const t = tests[i];
        await client.query(
          `
          INSERT INTO lab_tests
          (report_id, test_name, value, unit, normal_range, order_index)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [id, t.test_name, t.value, t.unit, t.normal_range, i]
        );
      }
    });

    res.json({ success: true, message: 'Tests updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update tests failed' });
  }
};
