import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import {
  CREATED,
  DELETED,
  UPDATED,
} from 'src/common/constant/operations.constant';
import { StoreId } from 'src/common/decorators/user.decorator';
import { AuthGuard } from '@nestjs/passport';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async created(@Body() dto: CreateUserDto, @StoreId() storeId: string) {
    await this.usersService.create(dto, storeId);
    return CREATED;
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('/staff')
  findAllStaff(@Req() req) {
    return this.usersService.findAllStaff(req.user.storeId);
  }
  @Get('/staff/pagination')
  findAllStaffPagination(
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Req() req,
  ) {
    const pageNumber = Math.max(1, Number(page));
    const pageSize = Math.max(1, Number(size));
    return this.usersService.findAllStaffPagination(
      pageNumber,
      pageSize,
      req.user.storeId,
    );
  }

  @Get('pagination')
  async getPagination(@Query('page') page = 1, @Query('size') size = 10) {
    const pageNumber = Math.max(1, Number(page));
    const pageSize = Math.max(1, Number(size));

    return this.usersService.getPagination(pageNumber, pageSize);
  }

  @Get('/profile/owner')
  profileOwner(@Req() req) {
    console.log(req, 'req');
    return this.usersService.findOwner(req.user.sub);
  }

  @Get('/profile/staff')
  profileStaff(@Req() req) {
    return this.usersService.findStaff(req.user);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    await this.usersService.update(id, dto);
    return UPDATED;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.usersService.remove(id);
    return DELETED;
  }
}
