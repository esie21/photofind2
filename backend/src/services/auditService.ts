import { pool } from '../config/database';
import { Request } from 'express';

export interface AuditLogParams {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  metadata?: Record<string, any>;
  req?: Request;
}

export type AuditAction =
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.restore'
  | 'user.suspend'
  | 'user.unsuspend'
  | 'user.verify'
  | 'user.reject_verification'
  | 'provider.verify'
  | 'provider.reject'
  | 'booking.create'
  | 'booking.update'
  | 'booking.cancel'
  | 'booking.delete'
  | 'review.create'
  | 'review.update'
  | 'review.delete'
  | 'review.moderate'
  | 'review.approve'
  | 'review.reject'
  | 'review.flag'
  | 'dispute.create'
  | 'dispute.update'
  | 'dispute.resolve'
  | 'dispute.escalate'
  | 'dispute.assign'
  | 'dispute.comment'
  | 'payment.create'
  | 'payment.refund'
  | 'payout.approve'
  | 'payout.reject'
  | 'payout.complete'
  | 'service.create'
  | 'service.update'
  | 'service.delete'
  | 'admin.login'
  | 'admin.settings_update'
  | 'system.config_change';

class AuditService {
  async log(params: AuditLogParams): Promise<void> {
    try {
      const {
        userId,
        action,
        entityType,
        entityId,
        oldValues,
        newValues,
        metadata,
        req,
      } = params;

      // Extract IP and user agent from request if available
      const ipAddress = req
        ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          req.socket?.remoteAddress ||
          null
        : null;
      const userAgent = req ? req.headers['user-agent'] || null : null;

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId || null,
          action,
          entityType,
          entityId || null,
          oldValues ? JSON.stringify(oldValues) : null,
          newValues ? JSON.stringify(newValues) : null,
          ipAddress,
          userAgent,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );
    } catch (error) {
      console.error('Failed to create audit log:', error);
      // Don't throw - audit logging should not break the main flow
    }
  }

  // Convenience methods for common actions
  async logUserAction(
    adminId: string,
    action: AuditAction,
    targetUserId: string,
    details: { oldValues?: Record<string, any>; newValues?: Record<string, any>; reason?: string },
    req?: Request
  ): Promise<void> {
    await this.log({
      userId: adminId,
      action,
      entityType: 'user',
      entityId: targetUserId,
      oldValues: details.oldValues,
      newValues: details.newValues,
      metadata: details.reason ? { reason: details.reason } : undefined,
      req,
    });
  }

  async logReviewAction(
    adminId: string,
    action: AuditAction,
    reviewId: string,
    details: { oldValues?: Record<string, any>; newValues?: Record<string, any>; reason?: string },
    req?: Request
  ): Promise<void> {
    await this.log({
      userId: adminId,
      action,
      entityType: 'review',
      entityId: reviewId,
      oldValues: details.oldValues,
      newValues: details.newValues,
      metadata: details.reason ? { reason: details.reason } : undefined,
      req,
    });
  }

  async logDisputeAction(
    adminId: string,
    action: AuditAction,
    disputeId: string,
    details: { oldValues?: Record<string, any>; newValues?: Record<string, any>; resolution?: string },
    req?: Request
  ): Promise<void> {
    await this.log({
      userId: adminId,
      action,
      entityType: 'dispute',
      entityId: disputeId,
      oldValues: details.oldValues,
      newValues: details.newValues,
      metadata: details.resolution ? { resolution: details.resolution } : undefined,
      req,
    });
  }

  async logPaymentAction(
    adminId: string,
    action: AuditAction,
    paymentId: string,
    details: { oldValues?: Record<string, any>; newValues?: Record<string, any>; amount?: number },
    req?: Request
  ): Promise<void> {
    await this.log({
      userId: adminId,
      action,
      entityType: 'payment',
      entityId: paymentId,
      oldValues: details.oldValues,
      newValues: details.newValues,
      metadata: details.amount ? { amount: details.amount } : undefined,
      req,
    });
  }

  // Get audit logs with filters
  async getLogs(filters: {
    userId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: any[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.userId) {
      conditions.push(`al.user_id::text = $${paramIndex}`);
      params.push(filters.userId);
      paramIndex++;
    }

    if (filters.action) {
      conditions.push(`al.action ILIKE $${paramIndex}`);
      params.push(`%${filters.action}%`);
      paramIndex++;
    }

    if (filters.entityType) {
      conditions.push(`al.entity_type = $${paramIndex}`);
      params.push(filters.entityType);
      paramIndex++;
    }

    if (filters.entityId) {
      conditions.push(`al.entity_id::text = $${paramIndex}`);
      params.push(filters.entityId);
      paramIndex++;
    }

    if (filters.startDate) {
      conditions.push(`al.created_at >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }

    if (filters.endDate) {
      conditions.push(`al.created_at <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const countQuery = `SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    const dataQuery = `
      SELECT al.*, u.name as user_name, u.email as user_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const dataResult = await pool.query(dataQuery, params);

    return {
      data: dataResult.rows,
      total,
    };
  }
}

export const auditService = new AuditService();
export default auditService;
