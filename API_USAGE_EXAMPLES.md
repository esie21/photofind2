// API Usage Examples - Copy these into your components

// ============================================
// AUTHENTICATION EXAMPLES
// ============================================

import authService from '@/api/services/authService';
import bookingService from '@/api/services/bookingService';
import userService from '@/api/services/userService';
import serviceService from '@/api/services/serviceService';

// Login Example
async function loginExample() {
  try {
    const response = await authService.login({
      email: 'user@example.com',
      password: 'password123'
    });
    
    // Token is automatically stored
    console.log('Logged in user:', response.user);
    console.log('User role:', response.user.role);
  } catch (error) {
    console.error('Login failed:', error);
  }
}

// Signup Example
async function signupExample() {
  try {
    const response = await authService.signup({
      email: 'newuser@example.com',
      password: 'password123',
      name: 'John Doe',
      role: 'client' // or 'provider'
    });
    
    console.log('Account created:', response.user);
  } catch (error) {
    console.error('Signup failed:', error);
  }
}

// Logout Example
async function logoutExample() {
  await authService.logout();
  console.log('Logged out successfully');
}

// Get Current User
async function getCurrentUserExample() {
  try {
    const user = await authService.getCurrentUser();
    console.log('Current user:', user);
  } catch (error) {
    console.error('Failed to get user:', error);
  }
}

// ============================================
// BOOKING EXAMPLES
// ============================================

// Get all bookings
async function getBookingsExample() {
  try {
    const bookings = await bookingService.getAllBookings();
    console.log('All bookings:', bookings);
  } catch (error) {
    console.error('Failed to fetch bookings:', error);
  }
}

// Create a booking
async function createBookingExample() {
  try {
    const newBooking = await bookingService.createBooking({
      providerId: '1',
      serviceId: '5',
      startDate: '2024-12-15T09:00:00Z',
      endDate: '2024-12-15T17:00:00Z',
      totalPrice: 500
    });
    
    console.log('Booking created:', newBooking);
  } catch (error) {
    console.error('Failed to create booking:', error);
  }
}

// Update booking status
async function updateBookingExample() {
  try {
    const updatedBooking = await bookingService.updateBooking('1', {
      status: 'confirmed'
    });
    
    console.log('Booking updated:', updatedBooking);
  } catch (error) {
    console.error('Failed to update booking:', error);
  }
}

// ============================================
// USER EXAMPLES
// ============================================

// Get all users
async function getAllUsersExample() {
  try {
    const users = await userService.getAllUsers();
    console.log('All users:', users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
  }
}

// Get specific user
async function getUserExample() {
  try {
    const user = await userService.getUserById('1');
    console.log('User details:', user);
  } catch (error) {
    console.error('Failed to fetch user:', error);
  }
}

// Update user profile
async function updateUserExample() {
  try {
    const updatedUser = await userService.updateUser('1', {
      name: 'Updated Name',
      email: 'newemail@example.com'
    });
    
    console.log('User updated:', updatedUser);
  } catch (error) {
    console.error('Failed to update user:', error);
  }
}

// ============================================
// SERVICE EXAMPLES
// ============================================

// Get all services
async function getAllServicesExample() {
  try {
    const services = await serviceService.getAllServices();
    console.log('All services:', services);
  } catch (error) {
    console.error('Failed to fetch services:', error);
  }
}

// Create a new service
async function createServiceExample() {
  try {
    const newService = await serviceService.createService({
      title: 'Professional Photography',
      description: 'High-quality photography for events and products',
      price: 250,
      category: 'Photography',
      images: ['https://example.com/photo1.jpg']
    });
    
    console.log('Service created:', newService);
  } catch (error) {
    console.error('Failed to create service:', error);
  }
}

// Update service
async function updateServiceExample() {
  try {
    const updatedService = await serviceService.updateService('1', {
      price: 300,
      description: 'Updated description'
    });
    
    console.log('Service updated:', updatedService);
  } catch (error) {
    console.error('Failed to update service:', error);
  }
}

// ============================================
// IN REACT COMPONENT EXAMPLE
// ============================================

import { useEffect, useState } from 'react';

export function ExampleComponent() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBookings = async () => {
      setLoading(true);
      try {
        const data = await bookingService.getAllBookings();
        setBookings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch');
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {bookings.map(booking => (
        <div key={booking.id}>
          <h3>Booking #{booking.id}</h3>
          <p>Status: {booking.status}</p>
          <p>Price: ${booking.totalPrice}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================
// USING WITH REACT HOOK FORM
// ============================================

import { useForm } from 'react-hook-form';

export function LoginForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      email: '',
      password: ''
    }
  });

  const onSubmit = async (data: any) => {
    try {
      const response = await authService.login(data);
      console.log('Login successful:', response);
      // Redirect or update state
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input
        {...register('email', { required: 'Email is required' })}
        type="email"
        placeholder="Email"
      />
      {errors.email && <span>{errors.email.message}</span>}

      <input
        {...register('password', { required: 'Password is required' })}
        type="password"
        placeholder="Password"
      />
      {errors.password && <span>{errors.password.message}</span>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
